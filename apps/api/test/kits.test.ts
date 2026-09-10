import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import { JobWorker } from '../src/jobs/jobWorker.js';
import type { KitDoc, JobDoc } from '../src/db/types.js';

async function waitForJob(db: Db, jobId: string, timeoutMs = 15000): Promise<JobDoc> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    if (job && (job.status === 'completed' || job.status === 'failed')) {
      if (job.status === 'completed') {
        const kit = await db.collection<KitDoc>('kits').findOne({ _id: job.kitId });
        if (kit && kit.status === 'ready') return job;
      } else {
        return job;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Job ${jobId} timed out waiting for completion`);
}

describe('Kit API Lifecycle, Builder Mutations & Optimistic Concurrency', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let userCookie: string;

  beforeAll(async () => {
    const conn = await setupTestDb();
    db = conn.db;
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearCollections(db);

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'kituser@example.com', password: 'Password123!' });
    userCookie = reg.headers['set-cookie']?.[0] ?? '';
  });

  it('end-to-end: creates kit, worker completes 16 stages offline, produces ready kit', async () => {
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Senior TypeScript Engineer. Must have TypeScript, React, and Node.js.',
        company_url: 'https://example.com/careers',
        days: 5,
      });

    expect(createRes.status).toBe(202);
    const { kitId, jobId } = createRes.body;
    expect(kitId).toBeDefined();
    expect(jobId).toBeDefined();

    // Await background worker processing to completion
    const job = await waitForJob(db, jobId);
    expect(job.status).toBe('completed');
    expect(job.progress).toBe(100);
    expect(job.currentStage).toBe(16);

    // Verify kit status is ready and has canonical Appendix A shape
    const kitRes = await request(app).get(`/api/kits/${kitId}`).set('Cookie', userCookie);

    expect(kitRes.status).toBe(200);
    expect(kitRes.body.status).toBe('ready');
    expect(kitRes.body.kit).not.toBeNull();
    expect(kitRes.body.kit.source).toBeDefined();
    expect(kitRes.body.kit.company_brief).toBeDefined();
    expect(kitRes.body.kit.role).toBeDefined();
    expect(kitRes.body.kit.questions.length).toBeGreaterThan(0);
    expect(kitRes.body.kit.flashcards.length).toBeGreaterThan(0);
    expect(kitRes.body.kit.schedule.days.length).toBe(5);
    expect(kitRes.body.kit.coverage).toBeDefined();

    // Verify user kit listing includes this kit
    const listRes = await request(app).get('/api/kits').set('Cookie', userCookie);

    expect(listRes.status).toBe(200);
    expect(listRes.body.kits).toHaveLength(1);
    expect(listRes.body.kits[0].id).toBe(kitId);
    expect(listRes.body.kits[0].status).toBe('ready');
  });

  it('optimistic concurrency: rejects mutation when kit version does not match', async () => {
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Staff Engineer JD',
        company_url: 'https://example.com',
        days: 3,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    // Kit is currently at version 1
    const patchRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version: 99, // Stale version
        action: 'pin',
        itemId: 'q1',
        pinned: true,
      });

    expect(patchRes.status).toBe(409);
    expect(patchRes.body.error.code).toBe('VERSION_CONFLICT');
    expect(patchRes.body.error.currentVersion).toBe(1);
  });

  it('mutations: pinning, editing, deleting, and derived recalculation', async () => {
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Backend Engineer. Must have Go and PostgreSQL.',
        company_url: 'https://example.com',
        days: 4,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    const kitBefore = await request(app)
      .get(`/api/kits/${kitId}`)
      .set('Cookie', userCookie);

    const targetQuestion = kitBefore.body.kit.questions[0];
    const initialVersion = kitBefore.body.version;

    // 1. Pin item
    const pinRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version: initialVersion,
        action: 'pin',
        itemId: targetQuestion.id,
        pinned: true,
      });

    expect(pinRes.status).toBe(200);
    expect(pinRes.body.version).toBe(initialVersion + 1);
    expect(pinRes.body.itemMeta[targetQuestion.id].pinned).toBe(true);

    // 2. Edit question text (marks edited: true)
    const editRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version: pinRes.body.version,
        action: 'edit_question',
        itemId: targetQuestion.id,
        prompt: 'Edited custom interview question text?',
      });

    expect(editRes.status).toBe(200);
    expect(editRes.body.itemMeta[targetQuestion.id].edited).toBe(true);
    expect(editRes.body.itemMeta[targetQuestion.id].editedAt).not.toBeNull();
    const updatedQ = editRes.body.kit.questions.find(
      (q: any) => q.id === targetQuestion.id,
    );
    expect(updatedQ.prompt).toBe('Edited custom interview question text?');

    // 3. Delete item (creates tombstone, removes from kit, id never reused)
    const deleteRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version: editRes.body.version,
        action: 'delete_item',
        itemId: targetQuestion.id,
        itemType: 'question',
      });

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.tombstones.questions.length).toBe(1);
    expect(
      deleteRes.body.kit.questions.some((q: any) => q.id === targetQuestion.id),
    ).toBe(false);

    // Derived coverage and schedule were deterministically recomputed
    expect(deleteRes.body.kit.schedule.days.length).toBe(4);
    expect(deleteRes.body.kit.coverage).toBeDefined();
  });

  it('scope locking: locks kit scope during scoped regeneration', async () => {
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Test Job Description',
        company_url: 'https://example.com',
        days: 2,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    // Trigger scoped regeneration for flashcards
    const regenRes = await request(app)
      .post(`/api/kits/${kitId}/regenerate`)
      .set('Cookie', userCookie)
      .send({ scope: 'flashcards' });

    expect(regenRes.status).toBe(202);
    expect(regenRes.body.jobId).toBeDefined();

    // Verify kit document reflects regeneratingScope
    const kitInDb = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(kitInDb!.regeneratingScope).toBe('flashcards');

    // Attempting another regeneration while locked returns 423
    const duplicateRegen = await request(app)
      .post(`/api/kits/${kitId}/regenerate`)
      .set('Cookie', userCookie)
      .send({ scope: 'flashcards' });

    expect(duplicateRegen.status).toBe(423);
  });
});
