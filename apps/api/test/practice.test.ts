import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { setupTestDb, teardownTestDb, clearCollections } from './setup.js';
import { orderPracticeCards } from '../src/routes/practice.routes.js';
import type { KitDoc, CardStatDoc } from '../src/db/types.js';
import type { Flashcard } from '@kit/core';

describe('Practice Mode and Weak Spots Joining', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let userCookie: string;
  let userId: string;

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
      .send({ email: 'practiceuser@example.com', password: 'Password123!' });
    userCookie = reg.headers['set-cookie']?.[0] ?? '';
    userId = reg.body.user.id;
  });

  it('practice-ordering: unseen cards first, then lowest confidence, then least recently seen, tie-break by ID', () => {
    const cards: Flashcard[] = [
      { id: 'f1', front: 'Card 1', back: 'Back 1', requirement_ids: [] },
      { id: 'f2', front: 'Card 2', back: 'Back 2', requirement_ids: [] },
      { id: 'f3', front: 'Card 3', back: 'Back 3', requirement_ids: [] },
      { id: 'f4', front: 'Card 4', back: 'Back 4', requirement_ids: [] },
      { id: 'f10', front: 'Card 10', back: 'Back 10', requirement_ids: [] },
    ];

    const statsMap = new Map<string, CardStatDoc>([
      // f1 has high confidence, seen recently
      [
        'f1',
        {
          _id: {} as any,
          userId: 'u',
          kitId: 'k',
          cardId: 'f1',
          attempts: 2,
          lastConfidence: 'high',
          confidenceScore: 0.9,
          lastSeenAt: new Date(2026, 1, 10),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      // f2 has low confidence, seen earlier
      [
        'f2',
        {
          _id: {} as any,
          userId: 'u',
          kitId: 'k',
          cardId: 'f2',
          attempts: 1,
          lastConfidence: 'low',
          confidenceScore: 0.2,
          lastSeenAt: new Date(2026, 1, 8),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      // f3 has medium confidence
      [
        'f3',
        {
          _id: {} as any,
          userId: 'u',
          kitId: 'k',
          cardId: 'f3',
          attempts: 1,
          lastConfidence: 'medium',
          confidenceScore: 0.6,
          lastSeenAt: new Date(2026, 1, 9),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      // f4 is unseen (attempts === 0)
      // f10 is unseen (no stat in map)
    ]);

    const ordered = orderPracticeCards(cards, statsMap);
    const orderedIds = ordered.map((c) => c.id);

    // Unseen first (f4, f10 tie-broken numerically -> f4 then f10)
    expect(orderedIds[0]).toBe('f4');
    expect(orderedIds[1]).toBe('f10');
    // Then lowest confidence: f2 (0.2)
    expect(orderedIds[2]).toBe('f2');
    // Then next lowest: f3 (0.6)
    expect(orderedIds[3]).toBe('f3');
    // Highest confidence last: f1 (0.9)
    expect(orderedIds[4]).toBe('f1');
  });

  it('updates practice confidence score with EWMA weighting', async () => {
    const kitId = 'kit-practice-ewma';
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId,
      status: 'ready',
      version: 1,
      inputHash: 'hash',
      input: { jd: 'JD', company_url: 'https://example.com', days: 1 },
      kit: {
        source: {
          company: 'C',
          company_url: 'u',
          role: 'R',
          location: 'L',
          jd_chars: 1,
          researched_at: '',
          pages_used: [],
        },
        company_brief: { summary: '', what_they_do: '', sources: [] },
        role: { title: '', seniority: '', responsibilities: [], requirements: [] },
        questions: [],
        flashcards: [{ id: 'f1', front: 'Q', back: 'A', requirement_ids: [] }],
        schedule: { days_available: 1, days: [] },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
      idCounters: { r: 0, q: 0, f: 1 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 1st practice: low confidence (0.2) -> score = 0.2
    const res1 = await request(app)
      .post(`/api/kits/${kitId}/practice`)
      .set('Cookie', userCookie)
      .send({ cardId: 'f1', confidence: 'low' });

    expect(res1.status).toBe(200);
    expect(res1.body.stat.confidenceScore).toBe(0.2);
    expect(res1.body.stat.attempts).toBe(1);

    // 2nd practice: high confidence (1.0) -> EWMA = 0.7 * 0.2 + 0.3 * 1.0 = 0.14 + 0.30 = 0.44
    const res2 = await request(app)
      .post(`/api/kits/${kitId}/practice`)
      .set('Cookie', userCookie)
      .send({ cardId: 'f1', confidence: 'high' });

    expect(res2.status).toBe(200);
    expect(res2.body.stat.confidenceScore).toBe(0.44);
    expect(res2.body.stat.attempts).toBe(2);
  });

  it('orphaned-stats: statistics for deleted cards are excluded, never reassigned', async () => {
    const kitId = 'kit-practice-orphan';
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId,
      status: 'ready',
      version: 1,
      inputHash: 'hash',
      input: { jd: 'JD', company_url: 'https://example.com', days: 1 },
      kit: {
        source: {
          company: 'C',
          company_url: 'u',
          role: 'R',
          location: 'L',
          jd_chars: 1,
          researched_at: '',
          pages_used: [],
        },
        company_brief: { summary: '', what_they_do: '', sources: [] },
        role: { title: '', seniority: '', responsibilities: [], requirements: [] },
        questions: [],
        flashcards: [
          // Only f2 is in the kit; f1 was previously deleted
          { id: 'f2', front: 'Card 2', back: 'Back 2', requirement_ids: [] },
        ],
        schedule: { days_available: 1, days: [] },
        coverage: { uncovered_requirement_ids: [], passes: 1 },
      },
      idCounters: { r: 0, q: 0, f: 2 },
      itemMeta: {},
      tombstones: {
        questions: [],
        flashcards: [{ fingerprint: 'old', at: new Date().toISOString() }],
      },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed orphaned stat for deleted card f1
    await db.collection<CardStatDoc>('cardStats').insertOne({
      _id: {} as any,
      userId,
      kitId,
      cardId: 'f1', // Deleted card
      attempts: 5,
      lastConfidence: 'low',
      confidenceScore: 0.1,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/kits/${kitId}/practice`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].id).toBe('f2');
    // f1 must be excluded from stats
    expect(res.body.stats['f1']).toBeUndefined();
  });

  it('weak-spots report joins requirements, question coverage, and practice confidence', async () => {
    const kitId = 'kit-weak-spots-test';
    await db.collection<KitDoc>('kits').insertOne({
      _id: kitId,
      userId,
      status: 'ready',
      version: 1,
      inputHash: 'hash',
      input: { jd: 'JD', company_url: 'https://example.com', days: 2 },
      kit: {
        source: {
          company: 'C',
          company_url: 'u',
          role: 'R',
          location: 'L',
          jd_chars: 1,
          researched_at: '',
          pages_used: [],
        },
        company_brief: { summary: '', what_they_do: '', sources: [] },
        role: {
          title: 'Fullstack',
          seniority: 'Senior',
          responsibilities: [],
          requirements: [
            {
              id: 'r1',
              text: 'Distributed Systems',
              kind: 'technical',
              priority: 'must',
            },
            { id: 'r2', text: 'TypeScript', kind: 'technical', priority: 'nice' },
          ],
        },
        questions: [
          {
            id: 'q1',
            prompt: 'TS Question',
            answer_outline: '',
            category: 'technical',
            difficulty: 2,
            requirement_ids: ['r2'],
          },
        ],
        flashcards: [
          { id: 'f1', front: 'Dist Sys', back: 'Raft', requirement_ids: ['r1'] },
          { id: 'f2', front: 'TS Types', back: 'Generics', requirement_ids: ['r2'] },
        ],
        schedule: { days_available: 2, days: [] },
        coverage: { uncovered_requirement_ids: ['r1'], passes: 1 },
      },
      idCounters: { r: 2, q: 1, f: 2 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/kits/${kitId}/weak-spots`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.weakSpots).toHaveLength(2);

    // r1 is a must-have with no question coverage, so it is high risk and sorted first
    const firstSpot = res.body.weakSpots[0];
    expect(firstSpot.requirementId).toBe('r1');
    expect(firstSpot.mustHaveRisk).toBe(true);
    expect(firstSpot.questionCount).toBe(0);
  });
});
