import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';
import { validateSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import type { SessionDoc } from '../db/types.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionDoc?: SessionDoc;
      requestId?: string;
    }
  }
}

export function extractToken(req: Request): string | null {
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        request_id: req.requestId ?? 'unknown',
      },
    });
    return;
  }

  try {
    const db = getDb();
    const result = await validateSession(db, token);
    if (!result) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
          request_id: req.requestId ?? 'unknown',
        },
      });
      return;
    }

    req.user = {
      id: result.user._id.toString(),
      email: result.user.email,
    };
    req.sessionDoc = result.session;
    next();
  } catch (err) {
    next(err);
  }
}
