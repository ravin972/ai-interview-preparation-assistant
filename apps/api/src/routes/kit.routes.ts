import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  assertValidKit,
  buildSchedule,
  canonicalKit,
  computeCoverage,
  normalizeJd,
  type Question,
  type Flashcard,
} from '@kit/core';
import { getDb, withTransaction } from '../db/client.js';
import { authenticate } from '../middleware/auth.js';
import {
  BadRequestError,
  ConflictError,
  LockedError,
  NotFoundError,
} from '../middleware/error.js';
import type { KitDoc, JobDoc, Tombstone } from '../db/types.js';
import { JobWorker, computeItemFingerprint } from '../jobs/jobWorker.js';

export const kitRouter = Router();

// Protect all kit routes with user authentication
kitRouter.use(authenticate);

const createKitSchema = z.object({
  jd: z.string().min(1, 'Job description required'),
  company_url: z.string().url('Valid company URL required'),
  days: z.number().int().min(1).max(60),
});

export function computeInputHash(userId: string, jd: string, companyUrl: string): string {
  const normJd = normalizeJd(jd).text;
  let normUrl: string;
  try {
    const parsed = new URL(companyUrl);
    normUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    normUrl = companyUrl;
  }
  return crypto
    .createHash('sha256')
    .update(`${userId}:${normJd}:${normUrl}`)
    .digest('hex');
}

/**
 * POST /api/kits - Create kit and job atomically in a transaction
 */
kitRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jd, company_url, days } = createKitSchema.parse(req.body);
    const userId = req.user!.id;
    const db = getDb();

    const inputHash = computeInputHash(userId, jd, company_url);

    // Check for existing active generation to prevent duplicates (idempotency boundary)
    const existingActiveKit = await db.collection<KitDoc>('kits').findOne({
      userId,
      inputHash,
      status: 'generating',
    });

    if (existingActiveKit) {
      const activeJob = await db.collection<JobDoc>('jobs').findOne({
        kitId: existingActiveKit._id,
        status: { $in: ['queued', 'running'] },
      });
      if (activeJob) {
        res.status(202).json({
          kitId: existingActiveKit._id,
          jobId: activeJob._id,
        });
        return;
      }
    }

    const kitId = `kit-${crypto.randomUUID()}`;
    const jobId = `job-${crypto.randomUUID()}`;
    const now = new Date();

    const kitDoc: KitDoc = {
      _id: kitId,
      userId,
      status: 'generating',
      version: 1,
      inputHash,
      input: { jd, company_url, days },
      idCounters: { r: 0, q: 0, f: 0 },
      itemMeta: {},
      tombstones: { questions: [], flashcards: [] },
      research: { pagesUsed: [], gaps: [], robotsBlocked: [], injectionFlags: [] },
      createdAt: now,
      updatedAt: now,
    };

    const jobDoc: JobDoc = {
      _id: jobId,
      userId,
      kitId,
      type: 'generate_kit',
      status: 'queued',
      currentStage: 0,
      lastCompletedStage: 0,
      stages: [],
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      attempt: 0,
      maxAttempts: 2,
      progress: 0,
      error: null,
      gaps: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // Atomic kit + job creation using multi-document transaction
    await withTransaction(async (session) => {
      await db.collection<KitDoc>('kits').insertOne(kitDoc, { session });
      await db.collection<JobDoc>('jobs').insertOne(jobDoc, { session });
    });

    // Worker triggered only AFTER successful transaction commit
    const worker = new JobWorker(db);
    worker.processJob(jobId).catch((err) => {
      const isClosed =
        err instanceof Error &&
        (err.name === 'MongoClientClosedError' ||
          err.name === 'MongoPoolClosedError' ||
          err.message.includes('Topology is closed') ||
          err.message.includes('closed connection pool') ||
          err.message.includes('ended') ||
          err.message.includes('client was closed'));
      if (!isClosed) {
        console.error(`[Worker] Failed background processing for job ${jobId}:`, err);
      }
    });

    res.status(202).json({ kitId, jobId });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/kits - List kits belonging to authenticated user
 */
kitRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const db = getDb();

    const kits = await db
      .collection<KitDoc>('kits')
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    const list = kits.map((k) => ({
      id: k._id,
      status: k.status,
      role: k.kit?.role
        ? { title: k.kit.role.title, seniority: k.kit.role.seniority }
        : null,
      company: k.kit?.source.company || null,
      days: k.input.days,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }));

    res.status(200).json({ kits: list });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/kits/:id - Fetch single kit by ID (user-scoped, 404 on IDOR)
 */
kitRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const db = getDb();

    const kit = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
    if (!kit) {
      throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
    }

    res.status(200).json({
      id: kit._id,
      status: kit.status,
      version: kit.version,
      input: kit.input,
      kit: kit.kit ?? null,
      itemMeta: kit.itemMeta,
      tombstones: kit.tombstones,
      research: kit.research,
      error: kit.error ?? null,
      createdAt: kit.createdAt,
      updatedAt: kit.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

const patchKitSchema = z.object({
  version: z.number().int(),
  action: z.enum([
    'pin',
    'edit_question',
    'edit_flashcard',
    'delete_item',
    'reorder_questions',
  ]),
  itemId: z.string().optional(),
  pinned: z.boolean().optional(),
  prompt: z.string().optional(),
  answer_outline: z.string().optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  front: z.string().optional(),
  back: z.string().optional(),
  itemType: z.enum(['question', 'flashcard']).optional(),
  orderedQuestionIds: z.array(z.string()).optional(),
});

/**
 * PATCH /api/kits/:id - Update editable kit state with optimistic concurrency & scope-lock
 */
kitRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const db = getDb();
    const body = patchKitSchema.parse(req.body);

    const kitDoc = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
    if (!kitDoc) {
      throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
    }

    if (!kitDoc.kit) {
      throw new BadRequestError('Kit is not ready for editing', 'KIT_NOT_READY');
    }

    // Scope lock enforcement (docs/STATE_MODEL.md section 7, F02)
    if (kitDoc.regeneratingScope) {
      const scope = kitDoc.regeneratingScope;
      let targetsLockedScope = false;

      if (scope === 'flashcards') {
        if (
          body.action === 'edit_flashcard' ||
          (body.action === 'delete_item' && body.itemType === 'flashcard') ||
          (body.action === 'pin' &&
            kitDoc.kit.flashcards.some((f) => f.id === body.itemId))
        ) {
          targetsLockedScope = true;
        }
      } else if (scope === 'questions' || scope.startsWith('questions')) {
        if (
          body.action === 'edit_question' ||
          body.action === 'reorder_questions' ||
          (body.action === 'delete_item' && body.itemType === 'question') ||
          (body.action === 'pin' &&
            kitDoc.kit.questions.some((q) => q.id === body.itemId))
        ) {
          targetsLockedScope = true;
        }
      }

      if (targetsLockedScope) {
        throw new LockedError(
          `Scope '${scope}' is currently regenerating and cannot be modified.`,
          'LOCKED',
        );
      }
    }

    // Early optimistic concurrency check (fast fail)
    if (kitDoc.version !== body.version) {
      res.status(409).json({
        error: {
          code: 'VERSION_CONFLICT',
          message: `Kit version conflict. Provided ${body.version}, current is ${kitDoc.version}`,
          currentVersion: kitDoc.version,
          request_id: req.requestId,
        },
      });
      return;
    }

    const kit = canonicalKit(kitDoc.kit);
    const itemMeta = { ...kitDoc.itemMeta };
    const tombstones = {
      questions: [...kitDoc.tombstones.questions],
      flashcards: [...kitDoc.tombstones.flashcards],
    };
    const now = new Date();

    if (body.action === 'pin') {
      const { itemId, pinned } = body;
      if (!itemId || pinned === undefined)
        throw new BadRequestError('itemId and pinned required');
      if (!itemMeta[itemId]) {
        itemMeta[itemId] = {
          origin: 'generated',
          edited: false,
          pinned,
          fingerprint: '',
          editedAt: null,
        };
      } else {
        itemMeta[itemId] = { ...itemMeta[itemId], pinned };
      }
    } else if (body.action === 'edit_question') {
      const { itemId, prompt, answer_outline, difficulty } = body;
      if (!itemId) throw new BadRequestError('itemId required');
      const qIndex = kit.questions.findIndex((q) => q.id === itemId);
      if (qIndex === -1) throw new NotFoundError('Question not found');

      const existingQ = kit.questions[qIndex]!;
      const newQ: Question = {
        ...existingQ,
        prompt: prompt ?? existingQ.prompt,
        answer_outline: answer_outline ?? existingQ.answer_outline,
        difficulty: difficulty ?? existingQ.difficulty,
      };
      kit.questions[qIndex] = newQ;

      const meta = itemMeta[itemId] ?? {
        origin: 'generated',
        edited: false,
        pinned: false,
        fingerprint: computeItemFingerprint(existingQ.prompt),
        editedAt: null,
      };
      itemMeta[itemId] = {
        ...meta,
        edited: true,
        editedAt: now.toISOString(),
      };
    } else if (body.action === 'edit_flashcard') {
      const { itemId, front, back } = body;
      if (!itemId) throw new BadRequestError('itemId required');
      const fIndex = kit.flashcards.findIndex((f) => f.id === itemId);
      if (fIndex === -1) throw new NotFoundError('Flashcard not found');

      const existingF = kit.flashcards[fIndex]!;
      const newF: Flashcard = {
        ...existingF,
        front: front ?? existingF.front,
        back: back ?? existingF.back,
      };
      kit.flashcards[fIndex] = newF;

      const meta = itemMeta[itemId] ?? {
        origin: 'generated',
        edited: false,
        pinned: false,
        fingerprint: computeItemFingerprint(existingF.front + existingF.back),
        editedAt: null,
      };
      itemMeta[itemId] = {
        ...meta,
        edited: true,
        editedAt: now.toISOString(),
      };
    } else if (body.action === 'delete_item') {
      const { itemId, itemType } = body;
      if (!itemId || !itemType) throw new BadRequestError('itemId and itemType required');

      if (itemType === 'question') {
        const q = kit.questions.find((x) => x.id === itemId);
        if (q) {
          const fingerprint = computeItemFingerprint(q.prompt);
          tombstones.questions.push({ fingerprint, at: now.toISOString() });
          kit.questions = kit.questions.filter((x) => x.id !== itemId);
        }
      } else if (itemType === 'flashcard') {
        const f = kit.flashcards.find((x) => x.id === itemId);
        if (f) {
          const fingerprint = computeItemFingerprint(f.front + f.back);
          tombstones.flashcards.push({ fingerprint, at: now.toISOString() });
          kit.flashcards = kit.flashcards.filter((x) => x.id !== itemId);
        }
      }
    } else if (body.action === 'reorder_questions') {
      const { orderedQuestionIds } = body;
      if (!orderedQuestionIds) throw new BadRequestError('orderedQuestionIds required');
      const qMap = new Map(kit.questions.map((q) => [q.id, q]));
      const reordered: Question[] = [];
      for (const qid of orderedQuestionIds) {
        const q = qMap.get(qid);
        if (q) {
          reordered.push(q);
          qMap.delete(qid);
        }
      }
      // Keep any remaining
      for (const q of qMap.values()) {
        reordered.push(q);
      }
      kit.questions = reordered;
    }

    // Deterministically recompute derived coverage and schedule
    const coverageReport = computeCoverage(kit.role.requirements, kit.questions);
    kit.coverage = {
      uncovered_requirement_ids: [
        ...coverageReport.uncoveredMust,
        ...coverageReport.uncoveredNice,
      ],
      passes: kit.coverage.passes,
    };

    kit.schedule = buildSchedule({
      questions: kit.questions,
      requirements: kit.role.requirements,
      days: kitDoc.input.days,
    });

    assertValidKit(kit);

    const newVersion = kitDoc.version + 1;

    // Database write is authoritative concurrency gate (F01)
    const updateResult = await db.collection<KitDoc>('kits').updateOne(
      { _id: id, userId, version: body.version },
      {
        $set: {
          kit,
          itemMeta,
          tombstones,
          version: newVersion,
          updatedAt: now,
        },
      },
    );

    if (updateResult.matchedCount === 0) {
      const latestDoc = await db.collection<KitDoc>('kits').findOne({ _id: id, userId });
      res.status(409).json({
        error: {
          code: 'VERSION_CONFLICT',
          message: `Kit version conflict. Provided ${body.version}, current is ${latestDoc?.version ?? 'unknown'}`,
          currentVersion: latestDoc?.version,
          request_id: req.requestId,
        },
      });
      return;
    }

    res.status(200).json({
      id,
      version: newVersion,
      kit,
      itemMeta,
      tombstones,
    });
  } catch (err) {
    next(err);
  }
});

const regenerateSchema = z.object({
  scope: z.string().min(1),
});

/**
 * POST /api/kits/:id/regenerate - Enqueue scoped regeneration job
 */
kitRouter.post(
  '/:id/regenerate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const id = req.params.id as string;
      const { scope } = regenerateSchema.parse(req.body);
      const db = getDb();
      const now = new Date();

      // Atomic claim conditioned on kit not already regenerating (F03)
      const claimResult = await db.collection<KitDoc>('kits').findOneAndUpdate(
        {
          _id: id,
          userId,
          $or: [{ regeneratingScope: { $exists: false } }, { regeneratingScope: null }],
        },
        {
          $set: {
            regeneratingScope: scope,
            updatedAt: now,
          },
        },
        { returnDocument: 'after' },
      );

      if (!claimResult) {
        // Distinguish between kit not found (404) vs already locked (423)
        const existingKit = await db
          .collection<KitDoc>('kits')
          .findOne({ _id: id, userId });
        if (!existingKit) {
          throw new NotFoundError('Kit not found', 'KIT_NOT_FOUND');
        }
        throw new LockedError(
          `Scope '${existingKit.regeneratingScope ?? 'unknown'}' is already regenerating`,
          'LOCKED',
        );
      }

      const jobId = `job-${crypto.randomUUID()}`;

      const jobDoc: JobDoc = {
        _id: jobId,
        userId,
        kitId: id,
        type: 'regenerate_scope',
        scope,
        status: 'queued',
        currentStage: 0,
        lastCompletedStage: 0,
        stages: [],
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        attempt: 0,
        maxAttempts: 2,
        progress: 0,
        error: null,
        gaps: [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection<JobDoc>('jobs').insertOne(jobDoc);

      res.status(202).json({ jobId, scope });
    } catch (err) {
      next(err);
    }
  },
);
