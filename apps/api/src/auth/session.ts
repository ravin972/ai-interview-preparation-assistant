import crypto from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import type { SessionDoc, UserDoc } from '../db/types.js';

export const SESSION_COOKIE_NAME = 'kit_session';
export const DEFAULT_SESSION_TTL_HOURS = 168; // 7 days

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

export function getSessionCookieOptions(
  ttlHours: number = DEFAULT_SESSION_TTL_HOURS,
): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttlHours * 3600 * 1000,
  };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Db,
  userId: string,
  ttlHours: number = DEFAULT_SESSION_TTL_HOURS,
): Promise<{ token: string; session: SessionDoc }> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);

  const sessionDoc: Omit<SessionDoc, '_id'> = {
    userId,
    tokenHash,
    expiresAt,
    createdAt: now,
  };

  const result = await db
    .collection<Omit<SessionDoc, '_id'>>('sessions')
    .insertOne(sessionDoc);
  const session: SessionDoc = {
    ...sessionDoc,
    _id: result.insertedId as ObjectId,
  };

  return { token, session };
}

export async function validateSession(
  db: Db,
  token: string,
): Promise<{ user: UserDoc; session: SessionDoc } | null> {
  if (!token || typeof token !== 'string') return null;

  const tokenHash = hashSessionToken(token);
  const now = new Date();

  const session = await db.collection<SessionDoc>('sessions').findOne({
    tokenHash,
    expiresAt: { $gt: now },
  });

  if (!session) return null;

  let userObjectId: ObjectId;
  try {
    userObjectId = new ObjectId(session.userId);
  } catch {
    return null;
  }

  const user = await db.collection<UserDoc>('users').findOne({ _id: userObjectId });
  if (!user) return null;

  return { user, session };
}

export async function destroySession(db: Db, token: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const tokenHash = hashSessionToken(token);
  const result = await db.collection('sessions').deleteOne({ tokenHash });
  return result.deletedCount > 0;
}
