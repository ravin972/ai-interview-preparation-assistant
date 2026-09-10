import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb } from './setup.js';
import type { JobDoc, KitDoc } from '../src/db/types.js';

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

describe('Phase 5 Complete API Smoke Flow', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const conn = await setupTestDb();
    db = conn.db;
    app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as any;
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await teardownTestDb();
  });

  it('executes full smoke flow: register → login → POST /api/kits → observe job → SSE progress → completed kit → GET kit → logout → verify session invalidated', async () => {
    // 1. REGISTER
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'smokeflow@example.com', password: 'SmokePassword123!' });

    expect(regRes.status).toBe(201);
    expect(regRes.body.user.email).toBe('smokeflow@example.com');
    const initialCookie = regRes.headers['set-cookie']?.[0];
    expect(initialCookie).toBeDefined();
    const cookie: string = initialCookie!;

    // 2. LOGIN
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'smokeflow@example.com', password: 'SmokePassword123!' });

    expect(loginRes.status).toBe(200);
    const sessionCookie: string = loginRes.headers['set-cookie']?.[0] ?? cookie;

    // Verify /api/auth/me works with session
    const meRes = await request(app).get('/api/auth/me').set('Cookie', sessionCookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('smokeflow@example.com');

    // 3. POST /api/kits (atomic transaction, enqueues job)
    const createKitRes = await request(app)
      .post('/api/kits')
      .set('Cookie', sessionCookie)
      .send({
        jd: 'Senior Backend Engineer. Must have Go, PostgreSQL, and Distributed Systems.',
        company_url: 'https://example.com/careers',
        days: 5,
      });

    expect(createKitRes.status).toBe(202);
    const { kitId, jobId } = createKitRes.body;
    expect(kitId).toMatch(/^kit-/);
    expect(jobId).toMatch(/^job-/);

    // 4. OBSERVE JOB (GET /api/jobs/:id)
    const jobPollRes = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Cookie', sessionCookie);

    expect(jobPollRes.status).toBe(200);
    expect(jobPollRes.body.id).toBe(jobId);
    expect(['queued', 'running', 'completed']).toContain(jobPollRes.body.status);

    // 5. SSE PROGRESS (connects, receives initial snapshot and events)
    const sseSnapshot = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/jobs/${jobId}/events`,
          headers: { Cookie: sessionCookie, Accept: 'text/event-stream' },
        },
        (res) => {
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString();
            if (buf.includes('job:snapshot') || buf.includes('stage:')) {
              req.destroy();
              resolve(buf);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', (err: any) => {
        if (err.code !== 'ECONNRESET' && err.message !== 'socket hang up') {
          reject(err);
        }
      });
    });

    expect(sseSnapshot).toContain('data:');

    // 6. WAIT FOR COMPLETED KIT (Worker completes 16 stages offline)
    const completedJob = await waitForJob(db, jobId);
    expect(completedJob.status).toBe('completed');
    expect(completedJob.progress).toBe(100);
    expect(completedJob.currentStage).toBe(16);

    // 7. GET KIT (GET /api/kits/:id)
    const kitRes = await request(app)
      .get(`/api/kits/${kitId}`)
      .set('Cookie', sessionCookie);

    expect(kitRes.status).toBe(200);
    expect(kitRes.body.id).toBe(kitId);
    expect(kitRes.body.status).toBe('ready');
    expect(kitRes.body.version).toBe(1);
    expect(kitRes.body.kit.role.title).toBeDefined();
    expect(kitRes.body.kit.role.requirements.length).toBeGreaterThan(0);
    expect(kitRes.body.kit.questions.length).toBeGreaterThan(0);
    expect(kitRes.body.kit.flashcards.length).toBeGreaterThan(0);
    expect(kitRes.body.kit.schedule.days).toHaveLength(5);
    expect(kitRes.body.kit.coverage.passes).toBe(1);

    // 8. LOGOUT
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // 9. VERIFY SESSION INVALIDATED
    const postLogoutMe = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie);

    expect(postLogoutMe.status).toBe(401);
    expect(postLogoutMe.body.error.code).toBe('UNAUTHORIZED');

    // Also verify kit access is rejected with 401
    const postLogoutKit = await request(app)
      .get(`/api/kits/${kitId}`)
      .set('Cookie', sessionCookie);

    expect(postLogoutKit.status).toBe(401);
  });
});
