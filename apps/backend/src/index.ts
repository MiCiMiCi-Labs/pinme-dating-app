import 'dotenv/config';
import app from './app';
import { ensureBucket, ensureChatMediaBucket, ensureVoiceBucket } from './lib/storage';
import { startCallSweeper, stopCallSweeper } from './lib/calls';

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await ensureBucket();
  await ensureVoiceBucket();
  await ensureChatMediaBucket();
  startCallSweeper();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] running on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    stopCallSweeper();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
