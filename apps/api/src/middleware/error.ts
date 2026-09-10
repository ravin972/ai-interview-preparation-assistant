import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MongoTransactionsRequiredError } from '../db/client.js';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code: string = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code: string = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict', code: string = 'CONFLICT') {
    super(409, code, message);
  }
}

export class LockedError extends AppError {
  constructor(message: string = 'Resource locked', code: string = 'LOCKED') {
    super(423, code, message);
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerId = req.headers['x-request-id'];
  const requestId =
    typeof headerId === 'string' && headerId.length > 0
      ? headerId
      : `req-${crypto.randomUUID()}`;

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        request_id: requestId,
      },
    });
    return;
  }

  // MongoTransactionsRequiredError: deployment is misconfigured — never leak
  // internal MongoDB details; return a clear operator-facing 503.
  if (err instanceof MongoTransactionsRequiredError) {
    res.status(503).json({
      error: {
        code: 'MONGODB_TRANSACTIONS_REQUIRED',
        message:
          'The service requires a transaction-capable MongoDB deployment (replica set or Atlas). ' +
          'Standalone MongoDB is not supported.',
        request_id: requestId,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: message || 'Invalid request body',
        request_id: requestId,
      },
    });
    return;
  }

  // Malformed JSON parser error
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status: number }).status === 400
  ) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload',
        request_id: requestId,
      },
    });
    return;
  }

  // Request entity too large
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds maximum permitted size',
        request_id: requestId,
      },
    });
    return;
  }

  // Unexpected internal server error - never leak stack traces
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err instanceof Error
        ? err.message
        : 'Internal server error';

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      request_id: requestId,
    },
  });
}
