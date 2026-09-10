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
      return job;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Job ${jobId} timed out waiting for completion`);
}

describe('Phase 6.5 Hardening Pass — F01, F02, F03, F04', () => {
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
      .send({ email: 'harden@example.com', password: 'Password123!' });
    userCookie = reg.headers['set-cookie']?.[0] ?? '';
  });

  // =========================================================================
  // F01: Optimistic Concurrency TOCTOU
  // =========================================================================
  it('F01: two concurrent PATCH requests with version V -> exactly one succeeds, one gets 409, final is V+1', async () => {
    // 1. Create kit
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Senior Full Stack Engineer with React and Node.js.',
        company_url: 'https://example.com',
        days: 3,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    // Initial ready kit is at v1. Advance to v3 via two sequential patches
    const p1 = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({ version: 1, action: 'pin', itemId: 'q1', pinned: true });
    expect(p1.status).toBe(200);
    expect(p1.body.version).toBe(2);

    const p2 = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({ version: 2, action: 'pin', itemId: 'f1', pinned: true });
    expect(p2.status).toBe(200);
    expect(p2.body.version).toBe(3);

    // Now kit is at version 3. Issue two concurrent mutations targeting v3
    const reqA = request(app).patch(`/api/kits/${kitId}`).set('Cookie', userCookie).send({
      version: 3,
      action: 'edit_question',
      itemId: 'q1',
      prompt: 'Prompt updated by Request A',
    });

    const reqB = request(app).patch(`/api/kits/${kitId}`).set('Cookie', userCookie).send({
      version: 3,
      action: 'edit_question',
      itemId: 'q1',
      prompt: 'Prompt updated by Request B',
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;

    expect(winner.body.version).toBe(4);
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');

    // Verify database state: version is exactly 4 and holds winner's update
    const finalDoc = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(finalDoc!.version).toBe(4);

    const q1Final = finalDoc!.kit!.questions.find((q) => q.id === 'q1');
    const winningPrompt =
      winner === resA ? 'Prompt updated by Request A' : 'Prompt updated by Request B';
    expect(q1Final!.prompt).toBe(winningPrompt);
  });

  // =========================================================================
  // F02: Scope Lock Enforcement
  // =========================================================================
  it('F02: locked scope returns 423 LOCKED, unrelated scope is allowed, cleared allows all', async () => {
    // 1. Create and complete kit
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'DevOps Engineer with Kubernetes and Terraform.',
        company_url: 'https://example.com',
        days: 3,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    // 2. Set regeneratingScope to "flashcards"
    await db
      .collection<KitDoc>('kits')
      .updateOne({ _id: kitId }, { $set: { regeneratingScope: 'flashcards' } });

    const kitBefore = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    const version = kitBefore!.version;

    // 3. Attempt mutation targeting flashcards -> must return 423 LOCKED
    const lockedRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version,
        action: 'edit_flashcard',
        itemId: 'f1',
        front: 'Attempted edit while locked',
      });

    expect(lockedRes.status).toBe(423);
    expect(lockedRes.body.error.code).toBe('LOCKED');

    // Also delete_item for flashcard returns 423
    const lockedDelete = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version,
        action: 'delete_item',
        itemId: 'f1',
        itemType: 'flashcard',
      });
    expect(lockedDelete.status).toBe(423);

    // 4. Mutation targeting unrelated scope (questions) -> allowed!
    const allowedRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version,
        action: 'edit_question',
        itemId: 'q1',
        prompt: 'Unrelated question edit allowed during flashcard regen',
      });

    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body.version).toBe(version + 1);

    // 5. Clear regeneration scope -> flashcards mutation now allowed
    await db
      .collection<KitDoc>('kits')
      .updateOne({ _id: kitId }, { $unset: { regeneratingScope: '' } });

    const afterClearedRes = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userCookie)
      .send({
        version: allowedRes.body.version,
        action: 'edit_flashcard',
        itemId: 'f1',
        front: 'Edit allowed after regeneration cleared',
      });

    expect(afterClearedRes.status).toBe(200);
    expect(afterClearedRes.body.version).toBe(allowedRes.body.version + 1);
  });

  // =========================================================================
  // F03: Atomic Regeneration Claim
  // =========================================================================
  it('F03: 10 simultaneous regeneration requests -> exactly 1 succeeds, 9 return 423, exactly 1 job created', async () => {
    // 1. Create kit
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userCookie)
      .send({
        jd: 'Lead Architect with Microservices and Event Streaming.',
        company_url: 'https://example.com',
        days: 4,
      });

    const { kitId, jobId } = createRes.body;
    await waitForJob(db, jobId);

    // 2. Launch 10 simultaneous regeneration requests
    const regenRequests = Array.from({ length: 10 }).map(() =>
      request(app)
        .post(`/api/kits/${kitId}/regenerate`)
        .set('Cookie', userCookie)
        .send({ scope: 'flashcards' }),
    );

    const responses = await Promise.all(regenRequests);

    const statusCounts: Record<number, number> = {};
    for (const res of responses) {
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
    }

    expect(statusCounts[202]).toBe(1);
    expect(statusCounts[423]).toBe(9);

    // Exactly 1 regeneration job should be inserted for this kit
    const regenJobs = await db
      .collection<JobDoc>('jobs')
      .find({ kitId, type: 'regenerate_scope' })
      .toArray();

    expect(regenJobs).toHaveLength(1);
    expect(regenJobs[0]!.scope).toBe('flashcards');
  });

  // =========================================================================
  // F04: Worker Lease Fencing
  // =========================================================================
  it('F04: stale worker whose lease expired cannot overwrite job or kit state', async () => {
    // 1. Create kit and job document directly
    const kitId = 'kit-fence-test';
    const jobId = 'job-fence-test';
    const userId = 'fence-user';
    const now = new Date();

    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId,
      inputHash: 'hash',
      input: { jd: 'JD text', company_url: 'https://example.com', days: 2 },
      status: 'generating',
      version: 1,
      idCounters: { r: 1, q: 1, f: 1 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: now,
      updatedAt: now,
    });

    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId,
      kitId,
      type: 'generate_kit',
      status: 'queued',
      currentStage: 0,
      lastCompletedStage: 0,
      stages: [],
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      attempt: 0,
      maxAttempts: 2,
      progress: 0,
      error: null,
      gaps: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Worker A claims the job
    const workerA = new JobWorker(db, 'worker-A');
    const claimedByA = await workerA.claimJob(jobId);
    expect(claimedByA).not.toBeNull();
    expect(claimedByA!.leaseOwner).toBe('worker-A');

    // Simulate lease expiration for Worker A
    await db
      .collection<JobDoc>('jobs')
      .updateOne(
        { _id: jobId },
        { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
      );

    // Worker B claims the expired job
    const workerB = new JobWorker(db, 'worker-B');
    const claimedByB = await workerB.claimJob(jobId);
    expect(claimedByB).not.toBeNull();
    expect(claimedByB!.leaseOwner).toBe('worker-B');

    // Now Worker A attempts completion on the job it previously claimed
    // executeJob will attempt terminal write conditioned on leaseOwner: 'worker-A'
    await workerA.executeJob(claimedByA!);

    // Job in DB must STILL have leaseOwner: 'worker-B' and NOT be marked completed by worker-A
    const jobAfterA = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(jobAfterA!.leaseOwner).toBe('worker-B');
    // Worker B is still authoritative and kit was not updated to ready by stale Worker A
    expect(jobAfterA!.status).toBe('running');

    const kitAfterA = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(kitAfterA!.status).toBe('generating');

    // Now Worker B executes and completes
    await workerB.executeJob(claimedByB!);

    const jobAfterB = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(jobAfterB!.status).toBe('completed');
    expect(jobAfterB!.leaseOwner).toBe('worker-B');

    const kitAfterB = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(kitAfterB!.status).toBe('ready');
  });
});
