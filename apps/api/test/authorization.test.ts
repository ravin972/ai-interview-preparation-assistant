import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import type { KitDoc, JobDoc } from '../src/db/types.js';

describe('Authorization and IDOR Invariants', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let userACookie: string;
  let userBCookie: string;
  let userAId: string;
  let userBId: string;

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

    // Create User A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({ email: 'userA@example.com', password: 'PasswordA123!' });
    userACookie = resA.headers['set-cookie']?.[0] ?? '';
    userAId = resA.body.user.id;

    // Create User B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({ email: 'userB@example.com', password: 'PasswordB123!' });
    userBCookie = resB.headers['set-cookie']?.[0] ?? '';
    userBId = resB.body.user.id;
  });

  it('IDOR Kit: User B requesting User A kit returns 404 (non-enumerable)', async () => {
    // User A creates a kit
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userACookie)
      .send({
        jd: 'Senior TypeScript Engineer with React and Node experience.',
        company_url: 'https://example.com/careers',
        days: 5,
      });

    expect(createRes.status).toBe(202);
    const { kitId } = createRes.body;

    // User A can access kit
    const accessA = await request(app)
      .get(`/api/kits/${kitId}`)
      .set('Cookie', userACookie);
    expect(accessA.status).toBe(200);

    // User B attempts to access User A's kit -> MUST return 404 (not 403, preventing enumeration)
    const accessB = await request(app)
      .get(`/api/kits/${kitId}`)
      .set('Cookie', userBCookie);

    expect(accessB.status).toBe(404);
    expect(accessB.body.error.code).toBe('KIT_NOT_FOUND');
  });

  it('IDOR Job: User B requesting User A job status or events returns 404', async () => {
    // User A creates a job
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userACookie)
      .send({
        jd: 'Backend Engineer specializing in distributed databases.',
        company_url: 'https://example.com/jobs',
        days: 7,
      });

    const { jobId } = createRes.body;

    // User A can access job status
    const accessA = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Cookie', userACookie);
    expect(accessA.status).toBe(200);

    // User B attempts to access User A's job status -> 404
    const accessB = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Cookie', userBCookie);
    expect(accessB.status).toBe(404);
    expect(accessB.body.error.code).toBe('JOB_NOT_FOUND');

    // User B attempts to access User A's SSE stream -> 404
    const sseB = await request(app)
      .get(`/api/jobs/${jobId}/events`)
      .set('Cookie', userBCookie);
    expect(sseB.status).toBe(404);
  });

  it('IDOR Practice: User B requesting User A practice data returns 404', async () => {
    // Setup a completed kit for User A
    const kitId = 'kit-test-user-a';
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId: userAId,
      status: 'ready',
      version: 1,
      inputHash: 'hash',
      input: { jd: 'Software Engineer', company_url: 'https://example.com', days: 3 },
      kit: {
        source: {
          company: 'Acme',
          company_url: 'https://example.com',
          role: 'Engineer',
          location: 'Remote',
          jd_chars: 100,
          researched_at: new Date().toISOString(),
          pages_used: [],
        },
        company_brief: { summary: 'Brief', what_they_do: 'Tech', sources: [] },
        role: {
          title: 'Engineer',
          seniority: 'Mid',
          responsibilities: [],
          requirements: [],
        },
        questions: [],
        flashcards: [
          { id: 'f1', front: 'What is Node?', back: 'JS Runtime', requirement_ids: [] },
        ],
        schedule: { days_available: 3, days: [] },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
      idCounters: { r: 0, q: 0, f: 1 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // User A can access practice
    const accessA = await request(app)
      .get(`/api/kits/${kitId}/practice`)
      .set('Cookie', userACookie);
    expect(accessA.status).toBe(200);

    // User B attempts to access User A's practice data -> 404
    const accessB = await request(app)
      .get(`/api/kits/${kitId}/practice`)
      .set('Cookie', userBCookie);
    expect(accessB.status).toBe(404);

    // User B attempts to submit practice review on User A's kit -> 404
    const postB = await request(app)
      .post(`/api/kits/${kitId}/practice`)
      .set('Cookie', userBCookie)
      .send({ cardId: 'f1', confidence: 'high' });
    expect(postB.status).toBe(404);

    // User B attempts to get User A's weak spots -> 404
    const weakB = await request(app)
      .get(`/api/kits/${kitId}/weak-spots`)
      .set('Cookie', userBCookie);
    expect(weakB.status).toBe(404);
  });

  it('IDOR Mutation: User B cannot mutate User A kit via PATCH', async () => {
    const kitId = 'kit-patch-target';
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId: userAId,
      status: 'ready',
      version: 1,
      inputHash: 'hash',
      input: { jd: 'JD', company_url: 'https://example.com', days: 2 },
      kit: {
        source: {
          company: 'Test',
          company_url: 'https://example.com',
          role: 'Dev',
          location: 'Remote',
          jd_chars: 50,
          researched_at: new Date().toISOString(),
          pages_used: [],
        },
        company_brief: { summary: 'S', what_they_do: 'W', sources: [] },
        role: {
          title: 'Dev',
          seniority: 'Junior',
          responsibilities: [],
          requirements: [],
        },
        questions: [],
        flashcards: [],
        schedule: { days_available: 2, days: [] },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
      idCounters: { r: 0, q: 0, f: 0 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const patchB = await request(app)
      .patch(`/api/kits/${kitId}`)
      .set('Cookie', userBCookie)
      .send({
        version: 1,
        action: 'pin',
        itemId: 'q1',
        pinned: true,
      });

    expect(patchB.status).toBe(404);
  });

  it('ignores client-supplied userId in requests and enforces authenticated user ID', async () => {
    // User A passes User B's ID in request body
    const createRes = await request(app)
      .post('/api/kits')
      .set('Cookie', userACookie)
      .send({
        jd: 'Test Job Description for user scoping.',
        company_url: 'https://example.com',
        days: 3,
        userId: userBId, // Attempted spoofing
      });

    expect(createRes.status).toBe(202);
    const { kitId } = createRes.body;

    // Verify in database that kit.userId === userAId, NOT userBId
    const storedKit = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(storedKit).not.toBeNull();
    expect(storedKit!.userId).toBe(userAId);
    expect(storedKit!.userId).not.toBe(userBId);
  });
});
