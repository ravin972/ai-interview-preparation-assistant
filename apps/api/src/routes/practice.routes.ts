import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { parseId, type Flashcard } from '@kit/core';
import { getDb } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import { BadRequestError, NotFoundError } from '../middleware/error.js';
import type { CardStatDoc, KitDoc } from '../db/types.js';

export const practiceRouter = Router();

practiceRouter.use(authenticate);

const CONFIDENCE_VALUES = {
  low: 0.2,
  medium: 0.6,
  high: 1.0,
} as const;

/**
 * Deterministic practice card ordering:
 * 1. Unseen first
 * 2. Lowest confidence next
 * 3. Least recently seen next
 * 4. Tie-break by numeric card id
 */
export function orderPracticeCards(
  cards: readonly Flashcard[],
  statsMap: ReadonlyMap<string, CardStatDoc>,
): Flashcard[] {
  return [...cards].sort((a, b) => {
    const statA = statsMap.get(a.id);
    const statB = statsMap.get(b.id);

    const attemptsA = statA?.attempts ?? 0;
    const attemptsB = statB?.attempts ?? 0;

    // 1. Unseen first
    if (attemptsA === 0 && attemptsB > 0) return -1;
    if (attemptsB === 0 && attemptsA > 0) return 1;

    // 2. Lowest confidence score first
    const confA = statA ? statA.confidenceScore : -1;
    const confB = statB ? statB.confidenceScore : -1;
    if (confA !== confB) {
      return confA - confB;
    }

    // 3. Least recently seen first
    const timeA = statA?.lastSeenAt ? new Date(statA.lastSeenAt).getTime() : 0;
    const timeB = statB?.lastSeenAt ? new Date(statB.lastSeenAt).getTime() : 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // 4. Deterministic tie-break by numeric id
    const numA = parseId(a.id)?.n ?? 0;
    const numB = parseId(b.id)?.n ?? 0;
    return numA - numB;
  });
}

/**
 * GET /api/kits/:id/practice - Get ordered practice cards + session summary
 */
practiceRouter.get(
  '/:id/practice',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const id = req.params.id as string;
      const db = getDb();

      const kitDoc = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
      if (!kitDoc || !kitDoc.kit) {
        throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
      }

      const cards = kitDoc.kit.flashcards;
      const validCardIds = new Set(cards.map((c) => c.id));

      // Fetch stats for this user and kit
      const rawStats = await db
        .collection<CardStatDoc>('cardStats')
        .find({ userId, kitId: id })
        .toArray();

      // Exclude orphaned stats for deleted cards
      const statsMap = new Map<string, CardStatDoc>();
      const sanitizedStats: Record<string, CardStatDoc> = {};
      for (const stat of rawStats) {
        if (validCardIds.has(stat.cardId)) {
          statsMap.set(stat.cardId, stat);
          sanitizedStats[stat.cardId] = stat;
        }
      }

      const orderedCards = orderPracticeCards(cards, statsMap);

      let coveredCount = 0;
      for (const card of cards) {
        const s = statsMap.get(card.id);
        if (s && s.attempts > 0) coveredCount += 1;
      }

      res.status(200).json({
        cards: orderedCards,
        stats: sanitizedStats,
        summary: {
          total: cards.length,
          covered: coveredCount,
          uncovered: cards.length - coveredCount,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

const submitPracticeSchema = z.object({
  cardId: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
});

/**
 * POST /api/kits/:id/practice - Record practice review with EWMA scoring
 */
practiceRouter.post(
  '/:id/practice',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const id = req.params.id as string;
      const { cardId, confidence } = submitPracticeSchema.parse(req.body);
      const db = getDb();

      const kitDoc = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
      if (!kitDoc || !kitDoc.kit) {
        throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
      }

      const card = kitDoc.kit.flashcards.find((c) => c.id === cardId);
      if (!card) {
        throw new NotFoundError('Card not found in kit', 'CARD_NOT_FOUND');
      }

      const now = new Date();
      const existing = await db
        .collection<CardStatDoc>('cardStats')
        .findOne({ userId, kitId: id, cardId });

      const confidenceValue = CONFIDENCE_VALUES[confidence];
      const newScore = existing
        ? 0.7 * existing.confidenceScore + 0.3 * confidenceValue
        : confidenceValue;

      const result = await db.collection<CardStatDoc>('cardStats').findOneAndUpdate(
        { userId, kitId: id, cardId },
        {
          $inc: { attempts: 1 },
          $set: {
            lastConfidence: confidence,
            confidenceScore: Math.round(newScore * 1000) / 1000,
            lastSeenAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );

      res.status(200).json({ stat: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/kits/:id/weak-spots - Join requirements + coverage + practice confidence
 */
practiceRouter.get(
  '/:id/weak-spots',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const id = req.params.id as string;
      const db = getDb();

      const kitDoc = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
      if (!kitDoc || !kitDoc.kit) {
        throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
      }

      const kit = kitDoc.kit;
      const rawStats = await db
        .collection<CardStatDoc>('cardStats')
        .find({ userId, kitId: id })
        .toArray();

      const statsMap = new Map<string, CardStatDoc>();
      for (const stat of rawStats) {
        statsMap.set(stat.cardId, stat);
      }

      const weakSpots = kit.role.requirements.map((req) => {
        const linkedQuestions = kit.questions.filter((q) =>
          q.requirement_ids.includes(req.id),
        );
        const linkedCards = kit.flashcards.filter((f) =>
          f.requirement_ids.includes(req.id),
        );

        let totalCardScore = 0;
        let practicedCards = 0;

        for (const card of linkedCards) {
          const stat = statsMap.get(card.id);
          if (stat && stat.attempts > 0) {
            totalCardScore += stat.confidenceScore;
            practicedCards += 1;
          }
        }

        const avgConfidence = practicedCards > 0 ? totalCardScore / practicedCards : 0;
        const hasQuestions = linkedQuestions.length > 0;
        const isMust = req.priority === 'must';

        // Strength score from 0 (very weak) to 100 (well prepared)
        let score = 0;
        if (hasQuestions) score += 40;
        score += Math.round(avgConfidence * 60);

        let status: 'unprepared' | 'needs_practice' | 'ready' = 'unprepared';
        if (score >= 70) status = 'ready';
        else if (score >= 35) status = 'needs_practice';

        return {
          requirementId: req.id,
          text: req.text,
          kind: req.kind,
          priority: req.priority,
          questionCount: linkedQuestions.length,
          flashcardCount: linkedCards.length,
          practicedCardCount: practicedCards,
          confidenceScore: Math.round(avgConfidence * 100) / 100,
          readinessScore: score,
          status,
          mustHaveRisk: isMust && status !== 'ready',
        };
      });

      // Sort weakest and highest risk first
      weakSpots.sort((a, b) => {
        if (a.mustHaveRisk !== b.mustHaveRisk) return a.mustHaveRisk ? -1 : 1;
        return a.readinessScore - b.readinessScore;
      });

      res.status(200).json({
        kitId: id,
        weakSpots,
      });
    } catch (err) {
      next(err);
    }
  },
);
