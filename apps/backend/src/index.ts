import 'dotenv/config';
import app from './app';
import { ensureBucket, ensureChatMediaBucket, ensureVoiceBucket } from './lib/storage';

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await ensureBucket();
  await ensureVoiceBucket();
  await ensureChatMediaBucket();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] running on port ${PORT}`);
  });
}

start();
