import { MongoClient, Db, ClientSession } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export interface DbConfig {
  uri?: string;
  dbName?: string;
}

export async function connectDb(
  config: DbConfig = {},
): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) {
    return { client, db };
  }

  const uri = config.uri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const dbName = config.dbName || process.env.MONGODB_DB || 'interview_kit';

  client = new MongoClient(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  db = client.db(dbName);

  return { client, db };
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectDb() first.');
  }
  return db;
}

export function getClient(): MongoClient {
  if (!client) {
    throw new Error('Database client not connected. Call connectDb() first.');
  }
  return client;
}

export async function closeDb(force: boolean = false): Promise<void> {
  if (client) {
    await client.close(force);
    client = null;
    db = null;
  }
}

/**
 * Thrown when the connected MongoDB deployment does not support multi-document
 * transactions (i.e. is not a replica set or sharded cluster).
 *
 * Kit + Job creation requires atomicity — "commit both or commit neither".
 * Never silently weaken this invariant by falling back to sequential writes.
 */
export class MongoTransactionsRequiredError extends Error {
  readonly code = 'MONGODB_TRANSACTIONS_REQUIRED';

  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(
      `MongoDB transactions are required but not supported by this deployment${detail}. ` +
        'Connect to a MongoDB replica set or Atlas cluster. ' +
        'Standalone MongoDB is not supported for production use.',
    );
    this.name = 'MongoTransactionsRequiredError';
  }
}

/**
 * Execute a function within a MongoDB multi-document transaction.
 *
 * INVARIANT: Kit + Job creation must either commit BOTH documents or commit
 * NEITHER. There is no fallback to sequential writes.
 *
 * Throws MongoTransactionsRequiredError if the connected MongoDB deployment
 * does not support transactions (i.e. is standalone, not a replica set).
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const currentClient = getClient();

  let session: ClientSession;
  try {
    session = currentClient.startSession();
  } catch (err) {
    throw new MongoTransactionsRequiredError(err);
  }

  try {
    let result: T | undefined;
    try {
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result!;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Do NOT fall back to sequential writes. These messages indicate the
      // deployment does not support transactions and must be misconfiguration.
      if (
        msg.includes('Transaction numbers are only allowed on a replica set member') ||
        msg.includes('Transactions are not supported')
      ) {
        throw new MongoTransactionsRequiredError(err instanceof Error ? err : undefined);
      }
      throw err;
    }
  } finally {
    await session.endSession();
  }
}
