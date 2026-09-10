import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';

describe('API Input Validation & Error Boundaries', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let userCookie: string;

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

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'valuser@example.com', password: 'Password123!' });
    userCookie = reg.headers['set-cookie']?.[0] ?? '';
  });

  it('rejects malformed JSON with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ bad json: true, ');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects registration with invalid email with 400', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'not-an-email',
      password: 'Password123!',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects registration with short password (< 8 chars) with 400', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@example.com',
      password: 'short',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects kit generation with invalid days values (0, 61, 2.5, null) with 400', async () => {
    const invalidDays = [0, 61, -1, 2.5, '5', null, undefined];

    for (const days of invalidDays) {
      const res = await request(app).post('/api/kits').set('Cookie', userCookie).send({
        jd: 'Valid Job Description',
        company_url: 'https://example.com',
        days,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects kit generation with empty job description with 400', async () => {
    const res = await request(app).post('/api/kits').set('Cookie', userCookie).send({
      jd: '',
      company_url: 'https://example.com',
      days: 5,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects kit generation with invalid company URL with 400', async () => {
    const res = await request(app).post('/api/kits').set('Cookie', userCookie).send({
      jd: 'Valid Job Description',
      company_url: 'not-a-valid-url',
      days: 5,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized payload exceeding 1MB limit with 413 Payload Too Large', async () => {
    const hugeJd = 'A'.repeat(1024 * 1024 * 2); // 2 MB string
    const res = await request(app).post('/api/kits').set('Cookie', userCookie).send({
      jd: hugeJd,
      company_url: 'https://example.com',
      days: 5,
    });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
