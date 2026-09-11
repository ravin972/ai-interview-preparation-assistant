import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Render Health Endpoint (GET /health)', () => {
  const app = createApp();

  it('returns HTTP 200 and safe status JSON on GET /health', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');

    // Ensure no sensitive internal state or secrets leaked
    expect(res.body).not.toHaveProperty('database');
    expect(res.body).not.toHaveProperty('env');
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('stack');
  });

  it('returns HTTP 200 on /health/live without requiring authentication', async () => {
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('does not require authentication headers or cookies', async () => {
    const res = await request(app)
      .get('/health')
      .set('Cookie', [])
      .set('Authorization', '');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
