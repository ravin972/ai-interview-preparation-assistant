import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { connectDb, closeDb } from '../src/db/client.js';
import { ensureIndexes } from '../src/db/indexes.js';

let replSet: MongoMemoryReplSet | null = null;
let testClient: MongoClient | null = null;
let testDb: Db | null = null;

export async function setupTestDb(): Promise<{ client: MongoClient; db: Db }> {
  const uri = process.env.TEST_MONGODB_URI;

  if (uri) {
    const conn = await connectDb({ uri, dbName: 'test_interview_kit' });
    testClient = conn.client;
    testDb = conn.db;
  } else {
    if (!replSet) {
      replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
    }
    const replUri = replSet.getUri();
    const conn = await connectDb({ uri: replUri, dbName: 'test_interview_kit' });
    testClient = conn.client;
    testDb = conn.db;
  }

  await ensureIndexes(testDb);
  return { client: testClient, db: testDb };
}

export async function teardownTestDb(): Promise<void> {
  await closeDb(true);
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

export async function clearCollections(db: Db): Promise<void> {
  const collections = ['users', 'sessions', 'kits', 'jobs', 'cardStats'];
  for (const name of collections) {
    try {
      await db.collection(name).deleteMany({});
    } catch {
      // Ignore if collection doesn't exist yet
    }
  }
}
