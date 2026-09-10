import { createApp } from './app.js';
import { connectDb, closeDb } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { startJobSweeper } from './jobs/jobSweeper.js';

const PORT = Number(process.env.PORT) || 4000;

async function bootstrap() {
  try {
    console.log('[API] Connecting to MongoDB...');
    const { db } = await connectDb();

    console.log('[API] Ensuring database indexes...');
    await ensureIndexes(db);

    console.log('[API] Starting job sweeper...');
    const stopSweeper = startJobSweeper(db);

    const app = createApp();
    const server = app.listen(PORT, () => {
      console.log(`[API] Server listening on port ${PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`[API] Received ${signal}, shutting down gracefully...`);
      stopSweeper();
      server.close(async () => {
        await closeDb();
        console.log('[API] Shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[API] Bootstrap failed:', err);
    process.exit(1);
  }
}

// Only run automatically if executed as main script
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  bootstrap();
}

export { createApp, bootstrap };
