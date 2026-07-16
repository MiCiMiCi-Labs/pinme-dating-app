// Jest `setupFiles` entry — runs before any test file's own imports are
// evaluated, which is the only point at which we can safely rewire
// DATABASE_URL/DIRECT_URL before src/lib/prisma.ts constructs its
// PrismaClient singleton (import statements are hoisted, so doing this
// inside a test file itself would run too late).
//
// Deliberately does NOT fall back to DATABASE_URL when TEST_DATABASE_URL is
// missing — DB-backed test files are responsible for detecting that and
// skipping themselves (see tests/calls.test.ts) rather than silently
// running against whatever DATABASE_URL happens to be configured.
process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}
