import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import EmbeddedPostgres from 'embedded-postgres';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pg = new EmbeddedPostgres(config);

function isInitialised() {
  return fs.existsSync(path.join(config.databaseDir, 'PG_VERSION'));
}

async function bootstrap() {
  if (!isInitialised()) {
    console.log('[shadow-db] initialising cluster...');
    await pg.initialise();
  }

  console.log('[shadow-db] starting...');
  await pg.start();

  const sql = fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8');

  // Prisma connects directly to the database named in SHADOW_DATABASE_URL
  // ("postgres") rather than creating a fresh one per run, so the stub has
  // to live there. Also applied to template1 as a defensive measure in case
  // that assumption ever changes and Prisma starts creating its own
  // throwaway databases (which inherit template1) instead.
  for (const database of ['postgres', 'template1']) {
    console.log(`[shadow-db] applying auth-schema/role stub to "${database}"...`);
    const client = pg.getPgClient(database);
    await client.connect();
    await client.query(sql);
    await client.end();
  }

  console.log('[shadow-db] stopping...');
  await pg.stop();

  console.log('[shadow-db] bootstrap complete. Run "npm run shadow-db:start" before prisma migrate dev.');
}

async function start() {
  if (!isInitialised()) {
    console.error('[shadow-db] not bootstrapped yet — run "npm run shadow-db:bootstrap" first.');
    process.exitCode = 1;
    return;
  }
  await pg.start();
  console.log(`[shadow-db] running on port ${config.port}. Leave this running, then in another terminal use prisma migrate dev/--create-only.`);
  // Keep the process alive; Ctrl+C stops the cluster (embedded-postgres
  // registers its own exit handler to shut the cluster down cleanly).
  await new Promise(() => {});
}

async function stop() {
  await pg.stop();
  console.log('[shadow-db] stopped.');
}

const command = process.argv[2];
const commands = { bootstrap, start, stop };

if (!commands[command]) {
  console.error(`Usage: node shadow-db/manage.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}

commands[command]().catch(error => {
  console.error('[shadow-db] failed:', error);
  process.exit(1);
});
