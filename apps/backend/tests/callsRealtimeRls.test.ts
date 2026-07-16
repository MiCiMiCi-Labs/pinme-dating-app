import { randomUUID } from 'crypto';
import { hasIsolatedTestDatabase, warnIfTestDatabaseMissing, TEST_RUN_PREFIX } from './testDbGuard';
import { prisma } from '../src/lib/prisma';

// Gate Review fix: apps/backend/prisma/migrations/20260716030000_calls_realtime_rls
// enables RLS on `calls` and adds a `calls_select_participants` policy.
// These tests exercise that policy directly at the Postgres level by
// impersonating the `authenticated` role with a given JWT `sub` claim,
// scoped to a single transaction via `SET LOCAL` (auto-reverts at
// COMMIT/ROLLBACK, so it's safe on a pooled connection reused by other
// tests). This is exactly the authorization decision both PostgREST and
// Supabase Realtime's per-subscriber check rely on — it is NOT a live,
// end-to-end Realtime websocket test (no test in this repo exercises that;
// see the final report's "unverified" callout).
warnIfTestDatabaseMissing('callsRealtimeRls.test');
const describeIfIsolatedDb = hasIsolatedTestDatabase() ? describe : describe.skip;

type TestUser = { id: string; supabaseAuthId: string };

async function createTestUser(label: string): Promise<TestUser> {
  const supabaseAuthId = randomUUID();
  const user = await prisma.user.create({
    data: {
      supabaseAuthId,
      email: `${TEST_RUN_PREFIX}-rls-${randomUUID()}@example.test`,
      name: `RlsTest ${label}`,
      gender: 'NON_BINARY',
      birthday: new Date('1995-01-01'),
    },
    select: { id: true, supabaseAuthId: true },
  });
  return user;
}

async function selectCallAsAuthUser(authUid: string, callId: string): Promise<Array<{ id: string }>> {
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated');
    await tx.$executeRawUnsafe(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      JSON.stringify({ sub: authUid })
    );
    return tx.$queryRawUnsafe<Array<{ id: string }>>('SELECT id FROM "calls" WHERE id = $1', callId);
  });
}

describeIfIsolatedDb('calls table RLS (Realtime/PostgREST authorization)', () => {
  let caller: TestUser;
  let callee: TestUser;
  let thirdParty: TestUser;
  let callId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    caller = await createTestUser('Caller');
    callee = await createTestUser('Callee');
    thirdParty = await createTestUser('ThirdParty');
    createdUserIds.push(caller.id, callee.id, thirdParty.id);

    const match = await prisma.match.create({ data: { user1Id: caller.id, user2Id: callee.id } });
    callId = randomUUID();
    await prisma.call.create({
      data: {
        id: callId,
        matchId: match.id,
        callerId: caller.id,
        calleeId: callee.id,
        roomName: `call:${callId}`,
        expiresAt: new Date(Date.now() + 45_000),
      },
    });
  });

  afterAll(async () => {
    // ID-scoped only — cascades User -> Match -> Call.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  test('caller can SELECT their own call under RLS', async () => {
    const rows = await selectCallAsAuthUser(caller.supabaseAuthId, callId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(callId);
  });

  test('callee can SELECT their own call under RLS', async () => {
    const rows = await selectCallAsAuthUser(callee.supabaseAuthId, callId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(callId);
  });

  test('a third-party authenticated user cannot SELECT a call they are not part of', async () => {
    const rows = await selectCallAsAuthUser(thirdParty.supabaseAuthId, callId);
    expect(rows).toHaveLength(0);
  });

  test('an authenticated JWT with no matching users row cannot SELECT any call', async () => {
    const rows = await selectCallAsAuthUser(randomUUID(), callId);
    expect(rows).toHaveLength(0);
  });

  test('the backend (postgres role) is unaffected by RLS — bypasses it entirely', async () => {
    const row = await prisma.call.findUnique({ where: { id: callId } });
    expect(row).not.toBeNull();
  });
});
