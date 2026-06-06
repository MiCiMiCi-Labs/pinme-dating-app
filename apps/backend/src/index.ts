import 'dotenv/config';
import app from './app';
import { ensureBucket } from './lib/storage';

const PORT = Number(process.env.PORT ?? 3000);

async function start() {
  await ensureBucket();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] running on port ${PORT}`);
  });
}

start();
