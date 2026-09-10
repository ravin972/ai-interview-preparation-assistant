import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import { SESSION_COOKIE_NAME } from '../src/auth/session.js';
import type { SessionDoc } from '../src/db/types.js';

describe('Authentication API (/api/auth)', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const conn = await setupTestDb();
    db = conn.db;
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearCollections(db);
  });

  it('registers a new user and sets a secure HttpOnly session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'alice@example.com',
      password: 'Password123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('alice@example.com');
    expect(res.body.user.id).toBeDefined();
    // Invariant: password or hash must NEVER appear in API response
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();

    // Check Set-Cookie header
    const cookieHeader = res.headers['set-cookie'];
    expect(cookieHeader).toBeDefined();
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
    expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieStr?.toLowerCase()).toContain('httponly');
    expect(cookieStr?.toLowerCase()).toContain('samesite=lax');
  });

  it('rejects duplicate email registration with 409 Conflict', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'alice@example.com',
      password: 'Password123!',
    });

    const res = await request(app).post('/api/auth/register').send({
      email: 'alice@example.com',
      password: 'AnotherPassword456!',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('authenticates an existing user on login and returns a valid session', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'bob@example.com',
      password: 'SecureBobPassword1!',
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'bob@example.com',
      password: 'SecureBobPassword1!',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('bob@example.com');
    expect(loginRes.headers['set-cookie']).toBeDefined();
  });

  it('rejects login with an incorrect password with 401 Unauthorized', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'bob@example.com',
      password: 'CorrectPassword!',
    });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'bob@example.com',
      password: 'WrongPassword!',
    });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for a non-existent email with 401 Unauthorized', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'nobody@example.com',
      password: 'SomePassword!',
    });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('retrieves current authenticated user from /api/auth/me', async () => {
    const regRes = await request(app).post('/api/auth/register').send({
      email: 'carol@example.com',
      password: 'CarolPassword123!',
    });

    const cookie = regRes.headers['set-cookie']?.[0] ?? '';

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('carol@example.com');
    expect(meRes.body.user.id).toBe(regRes.body.user.id);
  });

  it('rejects unauthenticated access to /api/auth/me with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('revokes session on logout and clears session cookie', async () => {
    const regRes = await request(app).post('/api/auth/register').send({
      email: 'david@example.com',
      password: 'DavidPassword123!',
    });

    const cookie = regRes.headers['set-cookie']?.[0] ?? '';

    // Verify session works
    const meBefore = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meBefore.status).toBe(200);

    // Logout
    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Verify session is revoked from database
    const sessions = await db.collection<SessionDoc>('sessions').find().toArray();
    expect(sessions.length).toBe(0);

    // Subsequent access fails
    const meAfter = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfter.status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    const regRes = await request(app).post('/api/auth/register').send({
      email: 'eve@example.com',
      password: 'EvePassword123!',
    });

    const cookie = regRes.headers['set-cookie']?.[0] ?? '';

    // Manually backdate the session's expiresAt in the database
    await db
      .collection<SessionDoc>('sessions')
      .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 3600 * 1000) } });

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(meRes.status).toBe(401);
  });
});
