import type { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, RateLimitRecord>();
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
  } = options;
  const keyGen =
    options.keyGenerator ??
    ((req: Request) => {
      return req.user?.id || req.ip || 'anonymous';
    });

  // Cleanup interval
  const interval = setInterval(
    () => {
      const now = Date.now();
      for (const [key, record] of hits.entries()) {
        if (record.resetAt <= now) {
          hits.delete(key);
        }
      }
    },
    Math.max(10000, windowMs),
  );

  // Allow test suites to clean up timer
  if (interval.unref) interval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGen(req);
    const now = Date.now();
    let record = hits.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          request_id: req.requestId ?? 'unknown',
        },
      });
      return;
    }

    next();
  };
}
