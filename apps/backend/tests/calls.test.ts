import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { hasIsolatedTestDatabase, warnIfTestDatabaseMissing, TEST_RUN_PREFIX } from './testDbGuard';
import { prisma } from '../src/lib/prisma';
import * as callsLib from '../src/lib/calls';
import { endActiveCallsForPair, expireIfStale, startCallSweeper, stopCallSweeper } from '../src/lib/calls';
import {
  getCallPreference,
  updateCallPreference,
  createCallInvitation,
} from '../src/controllers/callPreference';
import {
  startCall,
  getCall,
  getActiveCall,
  getCallLiveKitToken,
  acceptCall,
  declineCall,
  cancelCall,
  endCall,
  failCall,
} from '../src/controllers/callSessions';

// tests/setupEnv.ts (a Jest `setupFiles` entry, so it runs before this file's
// imports above are evaluated) already rewired DATABASE_URL/DIRECT_URL to
// TEST_DATABASE_URL when present. This just decides whether the suite below
// runs at all — no fallback to the default DATABASE_URL ever happens.
warnIfTestDatabaseMissing('calls.test');
const describeIfIsolatedDb = hasIsolatedTestDatabase() ? describe : describe.skip;

// Lightweight fakes for Express req/res so controllers can be exercised
// directly without spinning up HTTP + Supabase auth. requireAuth is a
// separate, already-trusted concern — these tests assert on the call
// state machine and authorization logic the controllers implement.
function mockRes() {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  res.status = function (code: number) {
    res.statusCode = code;
    return res as Response;
  };
  res.json = function (payload: unknown) {
    res.body = payload;
    return res as Response;
  };
  res.send = function () {
    return res as Response;
  };
  return res as Response & { statusCode: number; body: any };
}

function mockReq(userId: string, params: Record<string, string> = {}, body: unknown = {}): Request {
  return { userId, params, body } as unknown as Request;
}

type TestUser = { id: string; supabaseAuthId: string; name: string };

async function createTestUser(label: string): Promise<TestUser> {
  const supabaseAuthId = randomUUID();
  const user = await prisma.user.create({
    data: {
      supabaseAuthId,
      email: `${TEST_RUN_PREFIX}-${randomUUID()}@example.test`,
      name: `CallTest ${label}`,
      gender: 'NON_BINARY',
      birthday: new Date('1995-01-01'),
    },
    select: { id: true, supabaseAuthId: true, name: true },
  });
  return user;
}

async function createTestMatch(userAId: string, userBId: string) {
  // Match has a unique (user1Id, user2Id) constraint and several tests reuse
  // the same pair of test users — clear out any leftover match (and its
  // cascaded calls/preferences/messages) from a previous test first so each
  // test starts from a clean slate regardless of ordering.
  await prisma.match.deleteMany({
    where: {
      OR: [
        { user1Id: userAId, user2Id: userBId },
        { user1Id: userBId, user2Id: userAId },
      ],
    },
  });

  return prisma.match.create({
    data: { user1Id: userAId, user2Id: userBId },
  });
}

async function enableMutualCalling(matchId: string, userAId: string, userBId: string) {
  await prisma.callPreference.createMany({
    data: [
      { matchId, userId: userAId, audioEnabled: true },
      { matchId, userId: userBId, audioEnabled: true },
    ],
  });
}

describeIfIsolatedDb('private voice calling — backend state machine', () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    alice = await createTestUser('Alice');
    bob = await createTestUser('Bob');
    carol = await createTestUser('Carol');
    createdUserIds.push(alice.id, bob.id, carol.id);
  });

  afterAll(async () => {
    // Cleanup is scoped strictly to the specific user ids this run created
    // (never a blanket deleteMany({}) / table truncate) — cascades:
    // User -> Match -> Call/CallPreference/Message all cascade-delete from
    // there, so no real user/match/call/message data can ever be touched
    // even if this suite is accidentally pointed at a non-empty database.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  test('start is rejected until both sides mutually enable calling', async () => {
    const match = await createTestMatch(alice.id, bob.id);

    const reqStart = mockReq(alice.supabaseAuthId, { matchId: match.id });
    const resStart = mockRes();
    await startCall(reqStart, resStart);
    expect(resStart.statusCode).toBe(403);

    // Alice enables, Bob hasn't yet — still blocked.
    const reqPut = mockReq(alice.supabaseAuthId, { matchId: match.id }, { audioEnabled: true });
    const resPut = mockRes();
    await updateCallPreference(reqPut, resPut);
    expect(resPut.statusCode).toBe(200);
    expect(resPut.body).toMatchObject({ mineEnabled: true, theirsEnabled: false, mutuallyEnabled: false });

    const resStart2 = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), resStart2);
    expect(resStart2.statusCode).toBe(403);

    // Bob enables too — now mutually enabled.
    const resBobPut = mockRes();
    await updateCallPreference(
      mockReq(bob.supabaseAuthId, { matchId: match.id }, { audioEnabled: true }),
      resBobPut
    );
    expect(resBobPut.body).toMatchObject({ mutuallyEnabled: true });

    const resCheck = mockRes();
    await getCallPreference(mockReq(alice.supabaseAuthId, { matchId: match.id }), resCheck);
    expect(resCheck.body).toMatchObject({ mineEnabled: true, theirsEnabled: true, mutuallyEnabled: true });
  });

  test('call invitation is idempotent within the 24h cooldown', async () => {
    const match = await createTestMatch(alice.id, carol.id);

    const first = mockRes();
    await createCallInvitation(mockReq(alice.supabaseAuthId, { matchId: match.id }), first);
    expect(first.statusCode).toBe(201);
    expect(first.body.message.content).toContain('invited you to enable voice chat');

    const second = mockRes();
    await createCallInvitation(mockReq(alice.supabaseAuthId, { matchId: match.id }), second);
    expect(second.statusCode).toBe(429);
  });

  test('happy path: start -> accept -> end produces a duration system message, idempotently', async () => {
    const match = await createTestMatch(bob.id, carol.id);
    await enableMutualCalling(match.id, bob.id, carol.id);

    const startRes = mockRes();
    await startCall(mockReq(bob.supabaseAuthId, { matchId: match.id }), startRes);
    expect(startRes.statusCode).toBe(201);
    const callId = startRes.body.id;
    expect(startRes.body.status).toBe('RINGING');

    // GET :callId never issues a LiveKit token (poll-safe), and the
    // dedicated token endpoint refuses before ACCEPTED.
    const preAcceptGet = mockRes();
    await getCall(mockReq(bob.supabaseAuthId, { callId }), preAcceptGet);
    expect(preAcceptGet.body.livekit).toBeUndefined();

    const preAcceptToken = mockRes();
    await getCallLiveKitToken(mockReq(bob.supabaseAuthId, { callId }), preAcceptToken);
    expect(preAcceptToken.statusCode).toBe(409);

    // Only the callee (carol) may accept.
    const wrongAccept = mockRes();
    await acceptCall(mockReq(bob.supabaseAuthId, { callId }), wrongAccept);
    expect(wrongAccept.statusCode).toBe(403);

    const acceptRes = mockRes();
    await acceptCall(mockReq(carol.supabaseAuthId, { callId }), acceptRes);
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.body.status).toBe('ACCEPTED');
    // Accept is a pure state transition — it must never carry LiveKit
    // credentials. Only POST /:callId/livekit-token issues those.
    expect(acceptRes.body.livekit).toBeUndefined();

    // Repeat accept (e.g. a retried request after a dropped response) is
    // idempotent: still 200, still ACCEPTED, still no livekit field.
    const acceptAgain = mockRes();
    await acceptCall(mockReq(carol.supabaseAuthId, { callId }), acceptAgain);
    expect(acceptAgain.statusCode).toBe(200);
    expect(acceptAgain.body.status).toBe('ACCEPTED');
    expect(acceptAgain.body.livekit).toBeUndefined();

    // Post-accept, GET still returns no token (poll-safe)...
    const postAcceptGet = mockRes();
    await getCall(mockReq(bob.supabaseAuthId, { callId }), postAcceptGet);
    expect(postAcceptGet.body.livekit).toBeUndefined();

    // ...but the dedicated endpoint now issues one for either participant,
    // fetched separately by the caller (bob)...
    const postAcceptToken = mockRes();
    await getCallLiveKitToken(mockReq(bob.supabaseAuthId, { callId }), postAcceptToken);
    expect(postAcceptToken.statusCode).toBe(200);
    expect(postAcceptToken.body).toMatchObject({ roomName: `call:${callId}` });

    // ...and independently by the callee (carol) — accept and token issuance
    // are fully decoupled, so each side fetches its own credentials.
    const calleeToken = mockRes();
    await getCallLiveKitToken(mockReq(carol.supabaseAuthId, { callId }), calleeToken);
    expect(calleeToken.statusCode).toBe(200);
    expect(calleeToken.body).toMatchObject({ roomName: `call:${callId}` });

    // A non-participant (alice) cannot obtain credentials for this call.
    const nonParticipantToken = mockRes();
    await getCallLiveKitToken(mockReq(alice.supabaseAuthId, { callId }), nonParticipantToken);
    expect(nonParticipantToken.statusCode).toBe(404);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const endRes = mockRes();
    await endCall(mockReq(bob.supabaseAuthId, { callId }), endRes);
    expect(endRes.statusCode).toBe(200);
    expect(endRes.body.status).toBe('ENDED');
    expect(endRes.body.durationSec).toBeGreaterThanOrEqual(1);

    // Final state: LiveKit credentials must never be issued once the call
    // has ended.
    const postEndToken = mockRes();
    await getCallLiveKitToken(mockReq(bob.supabaseAuthId, { callId }), postEndToken);
    expect(postEndToken.statusCode).toBe(409);
    expect(postEndToken.body.status).toBe('ENDED');

    const messages = await prisma.message.findMany({ where: { callId } });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toMatch(/^Voice call · \d{2}:\d{2}$/);

    // Repeat end (caller retries, or callee also hits end) must be idempotent.
    const endAgain = mockRes();
    await endCall(mockReq(carol.supabaseAuthId, { callId }), endAgain);
    expect(endAgain.statusCode).toBe(200);
    expect(endAgain.body.status).toBe('ENDED');

    const messagesAfterRetry = await prisma.message.findMany({ where: { callId } });
    expect(messagesAfterRetry).toHaveLength(1);
  });

  test('accept succeeds even when LiveKit credential issuance fails — the two are fully decoupled', async () => {
    // This is the regression the fix targets: acceptCall used to call
    // issueLiveKitCredentials in the same request as the RINGING -> ACCEPTED
    // transition, so a LiveKit failure surfaced as a 500 *after* the DB was
    // already ACCEPTED — a client seeing that 500 could not tell the two
    // outcomes apart and had no safe way to recover. Now acceptCall never
    // calls issueLiveKitCredentials at all; only the dedicated
    // /livekit-token endpoint does, and its failure is isolated there.
    const match = await createTestMatch(alice.id, bob.id);
    await enableMutualCalling(match.id, alice.id, bob.id);

    const startRes = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
    const callId = startRes.body.id;

    const issueSpy = jest
      .spyOn(callsLib, 'issueLiveKitCredentials')
      .mockRejectedValue(new Error('LiveKit is not configured on this server'));

    try {
      const acceptRes = mockRes();
      await acceptCall(mockReq(bob.supabaseAuthId, { callId }), acceptRes);
      expect(acceptRes.statusCode).toBe(200);
      expect(acceptRes.body.status).toBe('ACCEPTED');
      expect(issueSpy).not.toHaveBeenCalled();

      const persisted = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(persisted.status).toBe('ACCEPTED');

      // The failure is now confined to whoever calls the token endpoint —
      // it does not roll back or corrupt the already-ACCEPTED call.
      const tokenRes = mockRes();
      await getCallLiveKitToken(mockReq(bob.supabaseAuthId, { callId }), tokenRes);
      expect(tokenRes.statusCode).toBe(500);

      const stillAccepted = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(stillAccepted.status).toBe('ACCEPTED');
    } finally {
      issueSpy.mockRestore();
      await endCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    }
  });

  test('race: concurrent cancel (caller) and accept (callee) only lets one side win', async () => {
    const match = await createTestMatch(alice.id, bob.id);
    // Preference already mutually enabled from the first test's match reuse
    // isn't guaranteed here (different match row), so enable explicitly.
    await enableMutualCalling(match.id, alice.id, bob.id);

    const startRes = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
    const callId = startRes.body.id;

    const [cancelRes, acceptRes] = await Promise.all([
      (async () => {
        const res = mockRes();
        await cancelCall(mockReq(alice.supabaseAuthId, { callId }), res);
        return res;
      })(),
      (async () => {
        const res = mockRes();
        await acceptCall(mockReq(bob.supabaseAuthId, { callId }), res);
        return res;
      })(),
    ]);

    const finalCall = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(['ACCEPTED', 'CANCELED']).toContain(finalCall.status);

    // Whichever transition lost should have observed a 200 (idempotent late
    // read) or 409 (conflict), never a crash, and never silently applied.
    expect([200, 409]).toContain(cancelRes.statusCode);
    expect([200, 409]).toContain(acceptRes.statusCode);

    if (finalCall.status === 'CANCELED') {
      const messages = await prisma.message.findMany({ where: { callId } });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Canceled voice call');
    } else {
      // Accept won the race — close it out so this pair isn't left "busy"
      // (an active call) for later tests reusing alice/bob.
      await endCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    }
  });

  test('expired RINGING call is corrected to MISSED on read', async () => {
    const match = await createTestMatch(bob.id, carol.id);
    await enableMutualCalling(match.id, bob.id, carol.id);

    const callId = randomUUID();
    await prisma.call.create({
      data: {
        id: callId,
        matchId: match.id,
        callerId: bob.id,
        calleeId: carol.id,
        roomName: `call:${callId}`,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const res = mockRes();
    await getCall(mockReq(carol.supabaseAuthId, { callId }), res);
    expect(res.body.status).toBe('MISSED');

    const messages = await prisma.message.findMany({ where: { callId } });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Missed voice call');
  });

  test('sweeper multi-instance safety: two concurrent expiry passes on the same call produce one MISSED message', async () => {
    // Simulates two backend instances' sweepers (or a sweeper racing a
    // client's GET) both discovering the same stale RINGING call at the
    // same time. Only whichever instance's guarded updateMany actually
    // flips RINGING -> MISSED should record the outcome message; the other
    // must see count === 0 and just re-read, never creating a duplicate.
    const match = await createTestMatch(alice.id, carol.id);
    await enableMutualCalling(match.id, alice.id, carol.id);

    const callId = randomUUID();
    await prisma.call.create({
      data: {
        id: callId,
        matchId: match.id,
        callerId: alice.id,
        calleeId: carol.id,
        roomName: `call:${callId}`,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    const [a, b] = await Promise.all([expireIfStale(call), expireIfStale(call)]);

    expect(a.status).toBe('MISSED');
    expect(b.status).toBe('MISSED');

    const messages = await prisma.message.findMany({ where: { callId } });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Missed voice call');
  });

  test('sweeper start/stop is safe to call repeatedly and does not throw', () => {
    startCallSweeper(60_000);
    startCallSweeper(60_000); // idempotent: second call is a no-op (handle already set)
    stopCallSweeper();
    stopCallSweeper(); // idempotent: stopping twice must not throw
  });

  test('a busy callee causes start to fail with 409', async () => {
    const matchAB = await createTestMatch(alice.id, carol.id);
    const matchBC = await createTestMatch(bob.id, carol.id);
    await enableMutualCalling(matchAB.id, alice.id, carol.id);
    await enableMutualCalling(matchBC.id, bob.id, carol.id);

    const first = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: matchAB.id }), first);
    expect(first.statusCode).toBe(201);

    // Carol is now RINGING with Alice; Bob tries to call her too.
    const second = mockRes();
    await startCall(mockReq(bob.supabaseAuthId, { matchId: matchBC.id }), second);
    expect(second.statusCode).toBe(409);

    // Clean up so neither alice nor carol are left "busy" for later tests.
    await cancelCall(mockReq(alice.supabaseAuthId, { callId: first.body.id }), mockRes());
  });

  test('true concurrency: two different callers on two different matches racing for the same callee — exactly one wins', async () => {
    // This is the scenario the row-locking in createCallWithLocking exists
    // for: the DB-level partial unique index only covers "same match", so
    // without the FOR UPDATE lock on the shared callee's User row, both of
    // these could race past each other's application-level busy check and
    // both successfully insert a Call row.
    const matchAliceCarol = await createTestMatch(alice.id, carol.id);
    const matchBobCarol = await createTestMatch(bob.id, carol.id);
    await enableMutualCalling(matchAliceCarol.id, alice.id, carol.id);
    await enableMutualCalling(matchBobCarol.id, bob.id, carol.id);

    const [aliceRes, bobRes] = await Promise.all([
      (async () => {
        const res = mockRes();
        await startCall(mockReq(alice.supabaseAuthId, { matchId: matchAliceCarol.id }), res);
        return res;
      })(),
      (async () => {
        const res = mockRes();
        await startCall(mockReq(bob.supabaseAuthId, { matchId: matchBobCarol.id }), res);
        return res;
      })(),
    ]);

    const statuses = [aliceRes.statusCode, bobRes.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const activeCallsForCarol = await prisma.call.findMany({
      where: {
        status: { in: ['RINGING', 'ACCEPTED'] },
        OR: [{ callerId: carol.id }, { calleeId: carol.id }],
      },
    });
    expect(activeCallsForCarol).toHaveLength(1);

    // Clean up the winning call so carol isn't left busy for later tests.
    const winner = aliceRes.statusCode === 201 ? aliceRes : bobRes;
    const winnerCallerAuthId = aliceRes.statusCode === 201 ? alice.supabaseAuthId : bob.supabaseAuthId;
    await cancelCall(mockReq(winnerCallerAuthId, { callId: winner.body.id }), mockRes());
  });

  test('disabling audioEnabled mid-ring cancels the pending call, not an accepted one', async () => {
    const match = await createTestMatch(alice.id, bob.id);
    await enableMutualCalling(match.id, alice.id, bob.id);

    const startRes = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
    expect(startRes.statusCode).toBe(201);
    const callId = startRes.body.id;

    const disableRes = mockRes();
    await updateCallPreference(
      mockReq(alice.supabaseAuthId, { matchId: match.id }, { audioEnabled: false }),
      disableRes
    );
    expect(disableRes.statusCode).toBe(200);

    const cancelledCall = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
    expect(cancelledCall.status).toBe('CANCELED');
  });

  test('block/unmatch linkage force-ends active calls (RINGING->CANCELED, ACCEPTED->ENDED)', async () => {
    const matchRinging = await createTestMatch(alice.id, carol.id);
    await enableMutualCalling(matchRinging.id, alice.id, carol.id);
    const ringingStart = mockRes();
    await startCall(mockReq(alice.supabaseAuthId, { matchId: matchRinging.id }), ringingStart);
    const ringingCallId = ringingStart.body.id;

    await endActiveCallsForPair(alice.id, carol.id);
    const ringingAfter = await prisma.call.findUniqueOrThrow({ where: { id: ringingCallId } });
    expect(ringingAfter.status).toBe('CANCELED');

    const matchAccepted = await createTestMatch(bob.id, carol.id);
    await enableMutualCalling(matchAccepted.id, bob.id, carol.id);
    const acceptedStart = mockRes();
    await startCall(mockReq(bob.supabaseAuthId, { matchId: matchAccepted.id }), acceptedStart);
    const acceptedCallId = acceptedStart.body.id;
    await acceptCall(mockReq(carol.supabaseAuthId, { callId: acceptedCallId }), mockRes());

    await endActiveCallsForPair(bob.id, carol.id);
    const acceptedAfter = await prisma.call.findUniqueOrThrow({ where: { id: acceptedCallId } });
    expect(acceptedAfter.status).toBe('ENDED');
    expect(acceptedAfter.durationSec).not.toBeNull();

    const messages = await prisma.message.findMany({
      where: { callId: { in: [ringingCallId, acceptedCallId] } },
    });
    expect(messages).toHaveLength(2);
  });

  describe('GET /calls/active — recovery after client-side state loss', () => {
    test('caller can recover their own outgoing RINGING call', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const activeRes = mockRes();
      await getActiveCall(mockReq(alice.supabaseAuthId), activeRes);
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.body.call).toMatchObject({ id: callId, status: 'RINGING' });
      expect(activeRes.body.call.livekit).toBeUndefined();

      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    });

    test('callee can recover their own incoming RINGING call', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const activeRes = mockRes();
      await getActiveCall(mockReq(bob.supabaseAuthId), activeRes);
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.body.call).toMatchObject({ id: callId, status: 'RINGING' });
      expect(activeRes.body.call.livekit).toBeUndefined();

      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    });

    test('caller and callee can each recover the same ACCEPTED call, without LiveKit credentials', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;
      await acceptCall(mockReq(bob.supabaseAuthId, { callId }), mockRes());

      const callerActiveRes = mockRes();
      await getActiveCall(mockReq(alice.supabaseAuthId), callerActiveRes);
      expect(callerActiveRes.statusCode).toBe(200);
      expect(callerActiveRes.body.call).toMatchObject({ id: callId, status: 'ACCEPTED' });
      expect(callerActiveRes.body.call.livekit).toBeUndefined();

      const calleeActiveRes = mockRes();
      await getActiveCall(mockReq(bob.supabaseAuthId), calleeActiveRes);
      expect(calleeActiveRes.statusCode).toBe(200);
      expect(calleeActiveRes.body.call).toMatchObject({ id: callId, status: 'ACCEPTED' });
      expect(calleeActiveRes.body.call.livekit).toBeUndefined();

      await endCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    });

    test('a terminal call is never returned as active', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;
      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());

      const activeRes = mockRes();
      await getActiveCall(mockReq(alice.supabaseAuthId), activeRes);
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.body).toEqual({ call: null });
    });

    test('an expired RINGING call is corrected to MISSED and reported as no active call', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const callId = randomUUID();
      await prisma.call.create({
        data: {
          id: callId,
          matchId: match.id,
          callerId: alice.id,
          calleeId: bob.id,
          roomName: `call:${callId}`,
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const activeRes = mockRes();
      await getActiveCall(mockReq(bob.supabaseAuthId), activeRes);
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.body).toEqual({ call: null });

      const corrected = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(corrected.status).toBe('MISSED');
    });

    test('a user with no RINGING/ACCEPTED call gets { call: null }', async () => {
      const activeRes = mockRes();
      await getActiveCall(mockReq(carol.supabaseAuthId), activeRes);
      expect(activeRes.statusCode).toBe(200);
      expect(activeRes.body).toEqual({ call: null });
    });
  });

  describe('POST /calls/:callId/fail — media/connection failure reporting', () => {
    test('caller can mark their own RINGING call FAILED', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const failRes = mockRes();
      await failCall(
        mockReq(alice.supabaseAuthId, { callId }, { failureReason: 'NETWORK_ERROR' }),
        failRes
      );
      expect(failRes.statusCode).toBe(200);
      expect(failRes.body.status).toBe('FAILED');
      expect(failRes.body.failureReason).toBe('NETWORK_ERROR');

      const messages = await prisma.message.findMany({ where: { callId } });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Voice call failed');
    });

    test('callee can mark their own RINGING call FAILED', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);

      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const failRes = mockRes();
      await failCall(
        mockReq(bob.supabaseAuthId, { callId }, { failureReason: 'MICROPHONE_DENIED' }),
        failRes
      );
      expect(failRes.statusCode).toBe(200);
      expect(failRes.body.status).toBe('FAILED');
      expect(failRes.body.failureReason).toBe('MICROPHONE_DENIED');
    });

    test('caller and callee can each mark an ACCEPTED call FAILED', async () => {
      const matchA = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(matchA.id, alice.id, bob.id);
      const startA = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: matchA.id }), startA);
      const callIdA = startA.body.id;
      await acceptCall(mockReq(bob.supabaseAuthId, { callId: callIdA }), mockRes());

      const failByCaller = mockRes();
      await failCall(
        mockReq(alice.supabaseAuthId, { callId: callIdA }, { failureReason: 'LIVEKIT_CONNECTION_FAILED' }),
        failByCaller
      );
      expect(failByCaller.statusCode).toBe(200);
      expect(failByCaller.body.status).toBe('FAILED');

      const matchB = await createTestMatch(alice.id, carol.id);
      await enableMutualCalling(matchB.id, alice.id, carol.id);
      const startB = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: matchB.id }), startB);
      const callIdB = startB.body.id;
      await acceptCall(mockReq(carol.supabaseAuthId, { callId: callIdB }), mockRes());

      const failByCallee = mockRes();
      await failCall(
        mockReq(carol.supabaseAuthId, { callId: callIdB }, { failureReason: 'LIVEKIT_CONNECTION_FAILED' }),
        failByCallee
      );
      expect(failByCallee.statusCode).toBe(200);
      expect(failByCallee.body.status).toBe('FAILED');
    });

    test('a non-participant cannot report a call as FAILED (404, existence not leaked)', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);
      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const failRes = mockRes();
      await failCall(
        mockReq(carol.supabaseAuthId, { callId }, { failureReason: 'NETWORK_ERROR' }),
        failRes
      );
      expect(failRes.statusCode).toBe(404);

      const untouched = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(untouched.status).toBe('RINGING');

      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    });

    test('a non-whitelisted failureReason is rejected with 400 and does not mutate the call', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);
      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const failRes = mockRes();
      await failCall(
        mockReq(alice.supabaseAuthId, { callId }, { failureReason: 'SOMETHING_MADE_UP' }),
        failRes
      );
      expect(failRes.statusCode).toBe(400);

      const untouched = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(untouched.status).toBe('RINGING');

      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());
    });

    test('repeated fail requests are idempotent and produce exactly one system message', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);
      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;

      const first = mockRes();
      await failCall(
        mockReq(alice.supabaseAuthId, { callId }, { failureReason: 'NETWORK_ERROR' }),
        first
      );
      expect(first.statusCode).toBe(200);

      const second = mockRes();
      await failCall(
        mockReq(bob.supabaseAuthId, { callId }, { failureReason: 'LIVEKIT_CONNECTION_FAILED' }),
        second
      );
      expect(second.statusCode).toBe(200);
      expect(second.body.status).toBe('FAILED');
      // Idempotent read of the already-FAILED call — the *original*
      // failureReason wins, a later retry (even with a different reason)
      // must not overwrite an already-terminal outcome.
      expect(second.body.failureReason).toBe('NETWORK_ERROR');

      const messages = await prisma.message.findMany({ where: { callId } });
      expect(messages).toHaveLength(1);
    });

    test('a call already in a different terminal state cannot be converted to FAILED', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);
      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;
      await cancelCall(mockReq(alice.supabaseAuthId, { callId }), mockRes());

      const failRes = mockRes();
      await failCall(
        mockReq(alice.supabaseAuthId, { callId }, { failureReason: 'NETWORK_ERROR' }),
        failRes
      );
      expect(failRes.statusCode).toBe(409);
      expect(failRes.body.status).toBe('CANCELED');

      const untouched = await prisma.call.findUniqueOrThrow({ where: { id: callId } });
      expect(untouched.status).toBe('CANCELED');
    });

    test('LiveKit credentials can never be issued once a call is FAILED', async () => {
      const match = await createTestMatch(alice.id, bob.id);
      await enableMutualCalling(match.id, alice.id, bob.id);
      const startRes = mockRes();
      await startCall(mockReq(alice.supabaseAuthId, { matchId: match.id }), startRes);
      const callId = startRes.body.id;
      await acceptCall(mockReq(bob.supabaseAuthId, { callId }), mockRes());
      await failCall(
        mockReq(alice.supabaseAuthId, { callId }, { failureReason: 'LIVEKIT_CONNECTION_FAILED' }),
        mockRes()
      );

      const tokenRes = mockRes();
      await getCallLiveKitToken(mockReq(bob.supabaseAuthId, { callId }), tokenRes);
      expect(tokenRes.statusCode).toBe(409);
      expect(tokenRes.body.status).toBe('FAILED');
    });
  });
});
