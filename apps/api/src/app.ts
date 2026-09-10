import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { requestIdMiddleware, errorHandler } from './middleware/error.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.routes.js';
import { kitRouter } from './routes/kit.routes.js';
import { jobRouter } from './routes/job.routes.js';
import { practiceRouter } from './routes/practice.routes.js';

export function createApp(): Express {
  const app = express();

  // 1. Security headers
  app.use(helmet());

  // 2. CORS configuration for browser frontend
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.use(
    cors({
      origin: webOrigin,
      credentials: true,
    }),
  );

  // 3. Cookie parser for first-party session token
  app.use(cookieParser());

  // 4. Request ID for observability
  app.use(requestIdMiddleware);

  // 5. JSON body parser with bounded payload size
  app.use(express.json({ limit: '1mb' }));

  // 6. Public health and readiness endpoints
  app.get(['/health', '/health/live', '/api/health', '/api/health/live'], (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get(['/health/ready', '/api/health/ready'], async (_req, res) => {
    try {
      const { getDb } = await import('./db/client.js');
      const db = getDb();
      const hello = await db.admin().command({ hello: 1 });
      const hasReplicaSet = Boolean(hello.setName);
      const isWritable = Boolean(hello.isWritablePrimary);

      if (!hasReplicaSet || !isWritable) {
        res.status(503).json({
          status: 'not_ready',
          error:
            'MongoDB deployment does not support transactions (replica set with writable primary required)',
          setName: hello.setName ?? null,
          isWritablePrimary: isWritable,
        });
        return;
      }

      res.status(200).json({
        status: 'ready',
        replicaSet: hello.setName,
        isWritablePrimary: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        status: 'not_ready',
        error: `Database unavailable: ${msg}`,
      });
    }
  });

  // 7. Rate limiters
  const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many authentication attempts, please try again later.',
  });

  const kitCreateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many kit generation requests, please try again in a moment.',
  });

  // 8. Mount routers
  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api/kits', practiceRouter); // Mount practice routes on /api/kits/:id/...
  app.use('/api/kits', kitRouter);
  app.use('/api/jobs', jobRouter);

  // 9. Central error handling
  app.use(errorHandler);

  return app;
}
