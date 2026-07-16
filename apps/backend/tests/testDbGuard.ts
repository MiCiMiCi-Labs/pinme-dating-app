import { randomUUID } from 'crypto';

// Every row any test creates is tagged with this run-scoped prefix (in the
// email/name) so cleanup can be audited and, more importantly, so cleanup
// code never needs to guess — it only ever deletes rows whose id is in a
// list this same test run collected, never a `deleteMany({})`-style sweep.
export const TEST_RUN_PREFIX = `calltest-${randomUUID()}`;

// DB-backed test files must call this at the top of their describe block
// and use the returned flag to decide whether to run for real or skip.
// Intentionally does NOT fall back to DATABASE_URL — a missing
// TEST_DATABASE_URL means "no isolated test database is configured", and
// running business-logic tests against whatever DATABASE_URL points at
// (potentially a shared dev/staging database used by other engineers) is
// exactly the risk this guard exists to prevent.
export function hasIsolatedTestDatabase(): boolean {
  if (process.env.NODE_ENV !== 'test') {
    return false;
  }
  return Boolean(process.env.TEST_DATABASE_URL);
}

export function warnIfTestDatabaseMissing(suiteName: string): void {
  if (!hasIsolatedTestDatabase()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${suiteName}] SKIPPED — TEST_DATABASE_URL is not set. Refusing to run DB-backed tests ` +
        'against the default DATABASE_URL to avoid touching a shared development database. ' +
        'Set TEST_DATABASE_URL to an isolated Postgres database (see apps/backend/.env.example, ' +
        '"Testing" section) to run this suite.'
    );
  }
}
