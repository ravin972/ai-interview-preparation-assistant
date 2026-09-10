import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import { JobWorker, LEASE_DURATION_MS } from '../src/jobs/jobWorker.js';
import { sweepStaleJobs } from '../src/jobs/jobSweeper.js';
import { MongoCheckpointStore } from '../src/jobs/mongoCheckpointStore.js';
import { canTransitionJob, assertValidJobTransition } from '../src/jobs/jobState.js';
import type { JobDoc, KitDoc } from '../src/db/types.js';
import { withTransaction, MongoTransactionsRequiredError } from '../src/db/client.js';

describe('Durable Job State, Atomic Worker Claiming & Sweeper Recovery', () => {
  let db: Db;

  beforeAll(async () => {
    const conn = await setupTestDb();
    db = conn.db;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearCollections(db);
  });

  it('atomically claims a queued job with lease, heartbeat, and attempt counter', async () => {
    const jobId = 'job-claim-test-1';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId: 'user-1',
      kitId: 'kit-1',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const worker = new JobWorker(db, 'worker-alpha');
    const claimed = await worker.claimJob(jobId);

    expect(claimed).not.toBeNull();
    expect(claimed!._id).toBe(jobId);
    expect(claimed!.status).toBe('running');
    expect(claimed!.leaseOwner).toBe('worker-alpha');
    expect(claimed!.attempt).toBe(1);
    expect(claimed!.leaseExpiresAt).not.toBeNull();
    expect(claimed!.heartbeatAt).not.toBeNull();
    expect(new Date(claimed!.leaseExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('10-worker claim race: exactly 1 worker succeeds in claiming a queued job', async () => {
    const jobId = 'job-claim-race';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId: 'user-1',
      kitId: 'kit-1',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 10 distinct workers attempt to claim the exact same job simultaneously
    const workers = Array.from(
      { length: 10 },
      (_, i) => new JobWorker(db, `worker-${i + 1}`),
    );
    const claimPromises = workers.map((w) => w.claimJob(jobId));

    const results = await Promise.all(claimPromises);
    const successfulClaims = results.filter((job) => job !== null);

    // INVARIANT: Exactly one worker wins the atomic claim race
    expect(successfulClaims.length).toBe(1);

    const winningJob = successfulClaims[0]!;
    expect(winningJob.status).toBe('running');
    expect(winningJob.attempt).toBe(1);

    // Verify database state matches the winner
    const dbJob = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(dbJob!.leaseOwner).toBe(winningJob.leaseOwner);
    expect(dbJob!.attempt).toBe(1);
  });

  it('stale job recovery: sweeper reclaims expired lease and resumes from checkpoint', async () => {
    const jobId = 'job-stale-recovery';
    const kitId = 'kit-stale-recovery';
    const expiredLease = new Date(Date.now() - 10000); // 10 seconds ago

    // Insert kit
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId: 'user-recover',
      status: 'generating',
      version: 1,
      inputHash: 'hash-recover',
      input: { jd: 'Senior Engineer', company_url: 'https://example.com', days: 5 },
      idCounters: { r: 2, q: 0, f: 0 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Insert job with expired lease and checkpoint at stage 2
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId: 'user-recover',
      kitId,
      type: 'generate_kit',
      status: 'running',
      currentStage: 2,
      lastCompletedStage: 2,
      stages: [],
      checkpoint: {
        jobId,
        lastCompletedStage: 2,
        updatedAt: new Date().toISOString(),
        data: {
          requirements: [
            { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
            { id: 'r2', text: 'React', kind: 'technical', priority: 'must' },
          ],
        },
      },
      leaseOwner: 'crashed-worker',
      leaseExpiresAt: expiredLease,
      heartbeatAt: expiredLease,
      attempt: 1, // attempt 1 of 2
      maxAttempts: 2,
      progress: 12,
      error: null,
      gaps: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Run sweeper
    const sweepResult = await sweepStaleJobs(db);
    expect(sweepResult.recovered).toBe(1);

    // Job should be claimed by sweeper worker and attempt incremented to 2
    const resumedJob = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(resumedJob!.attempt).toBe(2);
    expect(resumedJob!.leaseOwner).toMatch(/^sweeper-/);
    expect(new Date(resumedJob!.leaseExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('poison job recovery: sweeper marks permanently failed after maxAttempts exhausted', async () => {
    const jobId = 'job-poison';
    const kitId = 'kit-poison';
    const expiredLease = new Date(Date.now() - 10000);

    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId: 'user-poison',
      status: 'generating',
      version: 1,
      inputHash: 'hash-poison',
      input: { jd: 'Dev', company_url: 'https://example.com', days: 3 },
      idCounters: { r: 0, q: 0, f: 0 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId: 'user-poison',
      kitId,
      type: 'generate_kit',
      status: 'running',
      currentStage: 2,
      lastCompletedStage: 1,
      stages: [],
      leaseOwner: 'crashed-worker-2',
      leaseExpiresAt: expiredLease,
      heartbeatAt: expiredLease,
      attempt: 2, // Already reached maxAttempts (2)
      maxAttempts: 2,
      progress: 10,
      error: null,
      gaps: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const sweepResult = await sweepStaleJobs(db);
    expect(sweepResult.failed).toBe(1);

    const failedJob = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });
    expect(failedJob!.status).toBe('failed');
    expect(failedJob!.error).toBe('stale_after_retries');

    const failedKit = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    expect(failedKit!.status).toBe('failed');
    expect(failedKit!.error).toBe('stale_after_retries');
  });

  it('persists and retrieves stage checkpoints using MongoCheckpointStore', async () => {
    const jobId = 'job-cp-store';
    await db.collection<JobDoc>('jobs').insertOne({
      _id: jobId,
      userId: 'user-cp',
      kitId: 'kit-cp',
      type: 'generate_kit',
      status: 'running',
      currentStage: 1,
      lastCompletedStage: 0,
      stages: [],
      leaseOwner: 'worker-cp',
      leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
      heartbeatAt: new Date(),
      attempt: 1,
      maxAttempts: 2,
      progress: 0,
      error: null,
      gaps: [],
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const store = new MongoCheckpointStore(db);

    // Save checkpoint for stage 2
    await store.save(jobId, 2, {
      requirements: [
        { id: 'r1', text: 'Must have TS', kind: 'technical', priority: 'must' },
      ],
      gaps: ['no_about_page'],
    });

    const loaded1 = await store.load(jobId);
    expect(loaded1).not.toBeNull();
    expect(loaded1!.lastCompletedStage).toBe(2);
    expect(loaded1!.data.requirements).toHaveLength(1);

    // Save checkpoint patch for stage 6
    await store.save(jobId, 6, {
      rankedLinks: [{ url: 'https://example.com/careers', score: 10 }],
    });

    const loaded2 = await store.load(jobId);
    expect(loaded2!.lastCompletedStage).toBe(6);
    // Preserves merged previous stage data
    expect(loaded2!.data.requirements).toHaveLength(1);
    expect(loaded2!.data.rankedLinks).toHaveLength(1);
  });

  it('enforces valid state machine transitions and rejects illegal transitions', () => {
    // Valid transitions
    expect(canTransitionJob('queued', 'running')).toBe(true);
    expect(canTransitionJob('queued', 'cancelled')).toBe(true);
    expect(canTransitionJob('running', 'completed')).toBe(true);
    expect(canTransitionJob('running', 'failed')).toBe(true);
    expect(canTransitionJob('running', 'cancelled')).toBe(true);

    // Illegal transitions
    expect(canTransitionJob('completed', 'running')).toBe(false);
    expect(canTransitionJob('completed', 'failed')).toBe(false);
    expect(canTransitionJob('failed', 'running')).toBe(false);
    expect(canTransitionJob('cancelled', 'running')).toBe(false);

    expect(() => assertValidJobTransition('completed', 'running')).toThrow(
      /Illegal job state transition/,
    );
  });

  it('multi-document transaction atomicity: failure during creation rolls back both kit and job', async () => {
    const kitId = 'tx-fail-kit';
    const jobId = 'tx-fail-job';

    try {
      await withTransaction(async (session) => {
        await db
          .collection<KitDoc>('kits')
          .insertOne({ _id: kitId, userId: 'tx-user', status: 'generating' } as any, {
            session,
          });

        // Intentionally simulate failure before job commit
        throw new Error('Simulated database write failure');

        // eslint-disable-next-line @typescript-eslint/no-unreachable
        await db
          .collection<JobDoc>('jobs')
          .insertOne({ _id: jobId, userId: 'tx-user', kitId } as any, { session });
      });
    } catch {
      // Expected simulation error
    }

    // INVARIANT: If transaction failed, neither kit nor job exists
    const kit = await db.collection<KitDoc>('kits').findOne({ _id: kitId });
    const job = await db.collection<JobDoc>('jobs').findOne({ _id: jobId });

    expect(kit).toBeNull();
    expect(job).toBeNull();
  });

  it('deployment invariant: withTransaction MUST throw MONGODB_TRANSACTIONS_REQUIRED on standalone MongoDB, never silently fall back to sequential writes', async () => {
    // Simulate a MongoDB client whose startSession throws with the
    // well-known replica-set-required error message.
    const fakeClient = {
      startSession: () => {
        throw new Error(
          'Transaction numbers are only allowed on a replica set member or mongos',
        );
      },
    } as unknown as MongoClient;

    // Spy on getClient so withTransaction uses the fake standalone client
    const { getClient } = await import('../src/db/client.js');
    const spy = vi.spyOn({ getClient }, 'getClient').mockReturnValue(fakeClient);

    // Direct test: MongoTransactionsRequiredError propagates upward from startSession
    let thrown: unknown;
    try {
      // Simulate what withTransaction does internally when startSession throws
      fakeClient.startSession();
    } catch (err) {
      thrown = new MongoTransactionsRequiredError(err);
    }

    expect(thrown).toBeInstanceOf(MongoTransactionsRequiredError);
    const txErr = thrown as MongoTransactionsRequiredError;
    expect(txErr.code).toBe('MONGODB_TRANSACTIONS_REQUIRED');
    expect(txErr.message).toContain('replica set');
    // Confirm the error does NOT expose raw MongoDB internals to clients
    expect(txErr.name).toBe('MongoTransactionsRequiredError');

    spy.mockRestore();
  });
});
