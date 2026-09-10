import type { Db } from 'mongodb';

/**
 * Ensures all documented, purposeful indexes exist.
 * Documents why each index is chosen:
 * - users: email unique constraint for fast lookup and duplicate prevention
 * - sessions: tokenHash unique lookup, expiresAt TTL for auto-cleanup, userId for revocation
 * - kits: userId + createdAt for kit listing, _id + userId for ownership, userId + inputHash for dedupe
 * - jobs: status + leaseExpiresAt for atomic claiming and stale lease recovery, _id + userId for ownership
 * - cardStats: userId + kitId + cardId unique for card state, lastSeenAt for practice ordering
 */
export async function ensureIndexes(db: Db): Promise<void> {
  // 1. Users collection
  await db
    .collection('users')
    .createIndex({ email: 1 }, { unique: true, name: 'idx_users_email_unique' });

  // 2. Sessions collection
  await db
    .collection('sessions')
    .createIndex(
      { tokenHash: 1 },
      { unique: true, name: 'idx_sessions_tokenHash_unique' },
    );
  await db
    .collection('sessions')
    .createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'idx_sessions_expiresAt_ttl' },
    );
  await db
    .collection('sessions')
    .createIndex({ userId: 1 }, { name: 'idx_sessions_userId' });

  // 3. Kits collection
  await db
    .collection('kits')
    .createIndex({ userId: 1, createdAt: -1 }, { name: 'idx_kits_user_created' });
  await db
    .collection('kits')
    .createIndex({ _id: 1, userId: 1 }, { name: 'idx_kits_id_owner' });
  await db
    .collection('kits')
    .createIndex({ userId: 1, inputHash: 1 }, { name: 'idx_kits_user_inputHash' });

  // 4. Jobs collection
  await db
    .collection('jobs')
    .createIndex(
      { status: 1, leaseExpiresAt: 1 },
      { name: 'idx_jobs_status_leaseExpiresAt' },
    );
  await db
    .collection('jobs')
    .createIndex({ _id: 1, userId: 1 }, { name: 'idx_jobs_id_owner' });
  await db
    .collection('jobs')
    .createIndex({ userId: 1, createdAt: -1 }, { name: 'idx_jobs_user_created' });

  // 5. CardStats collection
  await db
    .collection('cardStats')
    .createIndex(
      { userId: 1, kitId: 1, cardId: 1 },
      { unique: true, name: 'idx_cardStats_user_kit_card_unique' },
    );
  await db
    .collection('cardStats')
    .createIndex(
      { userId: 1, kitId: 1, lastSeenAt: 1 },
      { name: 'idx_cardStats_user_kit_lastSeenAt' },
    );
}
