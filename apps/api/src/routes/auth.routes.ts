import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  createSession,
  destroySession,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '../auth/session.js';
import { authenticate, extractToken } from '../middleware/auth.js';
import { ConflictError, UnauthorizedError } from '../middleware/error.js';
import type { UserDoc } from '../db/types.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email('Valid email required').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Valid email required').trim().toLowerCase(),
  password: z.string().min(1, 'Password required'),
});

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = registerSchema.parse(req.body);
    const db = getDb();

    const existing = await db.collection<UserDoc>('users').findOne({ email });
    if (existing) {
      throw new ConflictError('Email already registered', 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const newUser: Omit<UserDoc, '_id'> = {
      email,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await db
      .collection<Omit<UserDoc, '_id'>>('users')
      .insertOne(newUser);
    const userId = insertResult.insertedId.toString();

    const { token } = await createSession(db, userId);

    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    res.status(201).json({
      user: {
        id: userId,
        email,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const db = getDb();

    const user = await db.collection<UserDoc>('users').findOne({ email });
    if (!user) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const userId = user._id.toString();
    const { token } = await createSession(db, userId);

    res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    res.status(200).json({
      user: {
        id: userId,
        email: user.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractToken(req);
    if (token) {
      const db = getDb();
      await destroySession(db, token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});
