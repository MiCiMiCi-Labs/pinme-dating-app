import 'dotenv/config';
import app from './app';
import { ensureBucket } from './lib/storage';

const PORT = process.env.PORT ?? 3000;

async function start() {
  await ensureBucket();
  app.listen(PORT, () => {
    console.log(`[server] running on port ${PORT}`);
  });
}

start();
