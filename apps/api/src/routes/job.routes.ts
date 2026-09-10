import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { NotFoundError } from '../middleware/error.js';
import type { JobDoc } from '../db/types.js';
import { globalSseBroadcaster } from '../jobs/sseBroadcaster.js';

export const jobRouter = Router();

jobRouter.use(authenticate);

/**
 * GET /api/jobs/:id - Query authoritative MongoDB job state (user-scoped)
 */
jobRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const db = getDb();

    const job = await db.collection<JobDoc>('jobs').findOne({ _id: id, userId });
    if (!job) {
      throw new NotFoundError('Job not found', 'JOB_NOT_FOUND');
    }

    res.status(200).json({
      id: job._id,
      kitId: job.kitId,
      status: job.status,
      currentStage: job.currentStage,
      lastCompletedStage: job.lastCompletedStage,
      progress: job.progress,
      stages: job.stages,
      error: job.error,
      gaps: job.gaps,
      attempt: job.attempt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id/events - SSE progress stream projected from MongoDB
 * Observability only. Client disconnects DO NOT abort the durable job.
 */
jobRouter.get('/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const db = getDb();

    const job = await db.collection<JobDoc>('jobs').findOne({ _id: id, userId });
    if (!job) {
      throw new NotFoundError('Job not found', 'JOB_NOT_FOUND');
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial snapshot directly from authoritative MongoDB state
    const initialEvent = {
      type: 'job:snapshot',
      jobId: job._id,
      status: job.status,
      currentStage: job.currentStage,
      lastCompletedStage: job.lastCompletedStage,
      progress: job.progress,
      stages: job.stages,
      error: job.error,
      gaps: job.gaps,
      timestamp: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

    // If job is already terminal, finish stream
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      res.end();
      return;
    }

    // Subscribe to live broadcaster
    const unsubscribe = globalSseBroadcaster.subscribe(job._id, (payload) => {
      res.write(payload);
    });

    // Periodic ping comment frame to keep connection alive
    const pingTimer = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // Handled by close listener
      }
    }, 15000);

    // Clean disconnect handling: remove listener and timer on socket close
    req.on('close', () => {
      clearInterval(pingTimer);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});
