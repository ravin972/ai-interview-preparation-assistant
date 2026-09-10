import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDb } from '../apps/api/src/db/client.js';
import { ensureIndexes } from '../apps/api/src/db/indexes.js';
import { createApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/auth/password.js';

async function main() {
  console.log('[DevStack] Starting in-memory MongoDB ReplicaSet...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  console.log('[DevStack] ReplicaSet started at:', uri);

  const { db } = await connectDb({ uri, dbName: 'dev_interview_kit' });
  await ensureIndexes(db);
  console.log('[DevStack] Database connected and indexes verified.');

  // Seed demo user
  const passwordHash = await hashPassword('Password123!');
  const now = new Date();
  await db.collection('users').updateOne(
    { email: 'test@example.com' },
    {
      $setOnInsert: {
        _id: 'user-demo-1',
        email: 'test@example.com',
        passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  console.log('[DevStack] Seeded demo user: test@example.com / Password123!');

  const app = createApp();
  const server = app.listen(4000, () => {
    console.log('[DevStack] API listening on http://localhost:4000');
  });

  process.on('SIGINT', async () => {
    console.log('[DevStack] Stopping...');
    server.close();
    await replSet.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[DevStack] Failed:', err);
  process.exit(1);
});
