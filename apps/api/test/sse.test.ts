import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import { globalSseBroadcaster } from '../src/jobs/sseBroadcaster.js';
import type { JobDoc } from '../src/db/types.js';

describe('SSE Progress Stream (/api/jobs/:id/events)', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let server: http.Server;
  let port: number;
  let userCookie: string;
  let userId: string;

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

  beforeEach(async () => {
    await clearCollections(db);

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'sseuser@example.com', password: 'Password123!' });
    userCookie = reg.headers['set-cookie']?.[0] ?? '';
    userId = reg.body.user.id;
  });

  it('delivers initial job snapshot immediately from MongoDB upon connection', async () => {
    const jobId = 'job-sse-init';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId,
      kitId: 'kit-1',
      type: 'generate_kit',
      status: 'running',
      currentStage: 4,
      lastCompletedStage: 3,
      stages: [],
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000),
      heartbeatAt: new Date(),
      attempt: 1,
      maxAttempts: 2,
      progress: 25,
      error: null,
      gaps: ['no_about_page'],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const receivedData = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/jobs/${jobId}/events`,
          headers: { Cookie: userCookie, Accept: 'text/event-stream' },
        },
        (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('job:snapshot')) {
              req.destroy();
              resolve(buffer);
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

    expect(receivedData).toContain('job:snapshot');
    expect(receivedData).toContain('"status":"running"');
    expect(receivedData).toContain('"currentStage":4');
    expect(receivedData).toContain('"progress":25');
  });

  it('cleans up SSE listeners upon disconnect without leaking listeners', async () => {
    const jobId = 'job-sse-cleanup';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId,
      kitId: 'kit-1',
      type: 'generate_kit',
      status: 'running',
      currentStage: 1,
      lastCompletedStage: 0,
      stages: [],
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000),
      heartbeatAt: new Date(),
      attempt: 1,
      maxAttempts: 2,
      progress: 6,
      error: null,
      gaps: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(globalSseBroadcaster.getSubscriberCount(jobId)).toBe(0);

    await new Promise<void>((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/jobs/${jobId}/events`,
          headers: { Cookie: userCookie, Accept: 'text/event-stream' },
        },
        (res) => {
          res.once('data', () => {
            expect(globalSseBroadcaster.getSubscriberCount(jobId)).toBe(1);
            req.destroy();
            setTimeout(() => {
              expect(globalSseBroadcaster.getSubscriberCount(jobId)).toBe(0);
              resolve();
            }, 50);
          });
        },
      );
      req.on('error', () => {});
    });
  });

  it('closing an SSE connection DOES NOT cancel or abort the underlying job', async () => {
    const jobId = 'job-sse-no-cancel';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId,
      kitId: 'kit-1',
      type: 'generate_kit',
      status: 'running',
      currentStage: 3,
      lastCompletedStage: 2,
      stages: [],
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60000),
      heartbeatAt: new Date(),
      attempt: 1,
      maxAttempts: 2,
      progress: 19,
      error: null,
      gaps: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await new Promise<void>((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/jobs/${jobId}/events`,
          headers: { Cookie: userCookie, Accept: 'text/event-stream' },
        },
        (res) => {
          res.once('data', () => {
            req.destroy();
            setTimeout(resolve, 50);
          });
        },
      );
      req.on('error', () => {});
    });

    // Authoritative MongoDB job state is unchanged and NOT cancelled
    const jobInDb = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(jobInDb).not.toBeNull();
    expect(jobInDb!.status).toBe('running');
    expect(jobInDb!.status).not.toBe('cancelled');
    expect(jobInDb!.status).not.toBe('failed');
  });

  it('rejects unauthenticated SSE connection requests with 401', async () => {
    const res = await request(app).get('/api/jobs/any-job/events');
    expect(res.status).toBe(401);
  });
});
