import { randomUUID } from 'crypto';
import request from 'supertest';
import { hasIsolatedTestDatabase, warnIfTestDatabaseMissing, TEST_RUN_PREFIX } from './testDbGuard';

// jest.mock calls are hoisted above imports by ts-jest, so this replaces the
// real Supabase client before app.ts (via middleware/auth.ts) ever imports
// it — no real network call to Supabase happens in this suite.
jest.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() } },
  supabaseServer: {},
  createSupabaseUserClient: jest.fn(),
}));

// eslint-disable-next-line import/first
import { supabase } from '../src/lib/supabase';
// eslint-disable-next-line import/first
import app from '../src/app';
// eslint-disable-next-line import/first
import { prisma } from '../src/lib/prisma';

warnIfTestDatabaseMissing('callsHttp.test');
const describeIfIsolatedDb = hasIsolatedTestDatabase() ? describe : describe.skip;

const mockGetUser = (supabase.auth.getUser as unknown as jest.Mock);

type TestUser = { id: string; supabaseAuthId: string };

async function createTestUser(label: string): Promise<TestUser> {
  const supabaseAuthId = randomUUID();
  const user = await prisma.user.create({
    data: {
      supabaseAuthId,
      email: `${TEST_RUN_PREFIX}-http-${randomUUID()}@example.test`,
      name: `CallHttpTest ${label}`,
      gender: 'NON_BINARY',
      birthday: new Date('1995-01-01'),
    },
    select: { id: true, supabaseAuthId: true },
  });
  return user;
}

function authAs(user: TestUser) {
  mockGetUser.mockResolvedValueOnce({ data: { user: { id: user.supabaseAuthId } }, error: null });
}

describeIfIsolatedDb('calls API — HTTP routing, auth, and authorization', () => {
  let userA: TestUser;
  let userB: TestUser;
  let userC: TestUser;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    userA = await createTestUser('A');
    userB = await createTestUser('B');
    userC = await createTestUser('C');
    createdUserIds.push(userA.id, userB.id, userC.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    mockGetUser.mockReset();
  });

  test('unauthenticated request is rejected with 401 by requireAuth', async () => {
    const res = await request(app).get('/api/v1/calls/incoming');
    expect(res.status).toBe(401);
  });

  test('a bearer token Supabase rejects is also 401', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid token' } });
    const res = await request(app).get('/api/v1/calls/incoming').set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });

  test('GET /calls/incoming hits the incoming route, not GET /:callId', async () => {
    authAs(userA);
    const res = await request(app).get('/api/v1/calls/incoming').set('Authorization', 'Bearer t');
    // If this were captured by GET /:callId (treating "incoming" as a
    // callId), it would 404. A 200 with a `calls` array proves the literal
    // /incoming route matched first.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('calls');
    expect(Array.isArray(res.body.calls)).toBe(true);
  });

  test('GET /calls/active is rejected with 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/calls/active');
    expect(res.status).toBe(401);
  });

  test('GET /calls/active hits the active route, not GET /:callId', async () => {
    authAs(userA);
    const res = await request(app).get('/api/v1/calls/active').set('Authorization', 'Bearer t');
    // If "active" were captured by GET /:callId (treating it as a literal
    // callId), a user with no active call would get 404 ("Call not found")
    // instead of 200 with `{ call: null }`.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ call: null });
  });

  test('POST /calls/devices hits the devices route, not POST /:matchId/start or /:matchId/token', async () => {
    authAs(userA);
    const res = await request(app)
      .post('/api/v1/calls/devices')
      .set('Authorization', 'Bearer t')
      .send({ token: `voiptoken-${randomUUID()}`, platform: 'IOS', environment: 'SANDBOX' });
    // /:matchId/start would 400 (invalid body) or 404 (bad match id) instead
    // of returning a registered device.
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ platform: 'IOS', environment: 'SANDBOX' });
  });

  test('DELETE /calls/devices/:token hits the devices route, not a stray /:matchId match', async () => {
    authAs(userA);
    const res = await request(app)
      .delete(`/api/v1/calls/devices/${randomUUID()}`)
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(204);
  });

  test('full call lifecycle over real HTTP: start, wrong-role rejections, non-participant 404, accept, end', async () => {
    const match = await prisma.match.create({ data: { user1Id: userA.id, user2Id: userB.id } });
    await prisma.callPreference.createMany({
      data: [
        { matchId: match.id, userId: userA.id, audioEnabled: true },
        { matchId: match.id, userId: userB.id, audioEnabled: true },
      ],
    });

    authAs(userA);
    const startRes = await request(app)
      .post(`/api/v1/calls/${match.id}/start`)
      .set('Authorization', 'Bearer t')
      .send({});
    expect(startRes.status).toBe(201);
    const callId = startRes.body.id;

    // GET /calls/active recovers the RINGING call for both sides — caller
    // and callee — without a livekit field, before either has accepted.
    authAs(userA);
    const callerActiveDuringRinging = await request(app)
      .get('/api/v1/calls/active')
      .set('Authorization', 'Bearer t');
    expect(callerActiveDuringRinging.status).toBe(200);
    expect(callerActiveDuringRinging.body.call).toMatchObject({ id: callId, status: 'RINGING' });
    expect(callerActiveDuringRinging.body.call.livekit).toBeUndefined();

    authAs(userB);
    const calleeActiveDuringRinging = await request(app)
      .get('/api/v1/calls/active')
      .set('Authorization', 'Bearer t');
    expect(calleeActiveDuringRinging.status).toBe(200);
    expect(calleeActiveDuringRinging.body.call).toMatchObject({ id: callId, status: 'RINGING' });
    expect(calleeActiveDuringRinging.body.call.livekit).toBeUndefined();

    // Non-participant cannot read the call (existence not leaked: 404, not 403).
    authAs(userC);
    const forbiddenGet = await request(app).get(`/api/v1/calls/${callId}`).set('Authorization', 'Bearer t');
    expect(forbiddenGet.status).toBe(404);

    // POST /:callId/accept must hit the accept route (not e.g. /:matchId/start
    // mis-capturing callId as matchId) and enforce caller != callee.
    authAs(userA);
    const callerTriesAccept = await request(app)
      .post(`/api/v1/calls/${callId}/accept`)
      .set('Authorization', 'Bearer t');
    expect(callerTriesAccept.status).toBe(403);

    // Callee cannot cancel (only the caller can).
    authAs(userB);
    const calleeTriesCancel = await request(app)
      .post(`/api/v1/calls/${callId}/cancel`)
      .set('Authorization', 'Bearer t');
    expect(calleeTriesCancel.status).toBe(403);

    authAs(userB);
    const acceptRes = await request(app)
      .post(`/api/v1/calls/${callId}/accept`)
      .set('Authorization', 'Bearer t');
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe('ACCEPTED');
    // Accept is a pure state transition — LiveKit credentials are never
    // issued or returned from this endpoint.
    expect(acceptRes.body.livekit).toBeUndefined();

    // Repeat accept (retried request) is idempotent over real HTTP too.
    authAs(userB);
    const acceptAgain = await request(app)
      .post(`/api/v1/calls/${callId}/accept`)
      .set('Authorization', 'Bearer t');
    expect(acceptAgain.status).toBe(200);
    expect(acceptAgain.body.status).toBe('ACCEPTED');
    expect(acceptAgain.body.livekit).toBeUndefined();

    // GET /calls/active now recovers the ACCEPTED call for both sides —
    // still no livekit field; that's only ever obtained via livekit-token.
    authAs(userA);
    const callerActiveDuringAccepted = await request(app)
      .get('/api/v1/calls/active')
      .set('Authorization', 'Bearer t');
    expect(callerActiveDuringAccepted.status).toBe(200);
    expect(callerActiveDuringAccepted.body.call).toMatchObject({ id: callId, status: 'ACCEPTED' });
    expect(callerActiveDuringAccepted.body.call.livekit).toBeUndefined();

    authAs(userB);
    const calleeActiveDuringAccepted = await request(app)
      .get('/api/v1/calls/active')
      .set('Authorization', 'Bearer t');
    expect(calleeActiveDuringAccepted.status).toBe(200);
    expect(calleeActiveDuringAccepted.body.call).toMatchObject({ id: callId, status: 'ACCEPTED' });
    expect(calleeActiveDuringAccepted.body.call.livekit).toBeUndefined();

    // GET :callId never carries a livekit token, even post-accept.
    authAs(userA);
    const statusGet = await request(app).get(`/api/v1/calls/${callId}`).set('Authorization', 'Bearer t');
    expect(statusGet.body.livekit).toBeUndefined();

    // Dedicated token endpoint works for either participant post-accept.
    authAs(userA);
    const tokenRes = await request(app)
      .post(`/api/v1/calls/${callId}/livekit-token`)
      .set('Authorization', 'Bearer t');
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toMatchObject({ roomName: `call:${callId}` });

    authAs(userB);
    const calleeTokenRes = await request(app)
      .post(`/api/v1/calls/${callId}/livekit-token`)
      .set('Authorization', 'Bearer t');
    expect(calleeTokenRes.status).toBe(200);
    expect(calleeTokenRes.body).toMatchObject({ roomName: `call:${callId}` });

    // Non-participant cannot obtain credentials either (existence not leaked).
    authAs(userC);
    const nonParticipantTokenRes = await request(app)
      .post(`/api/v1/calls/${callId}/livekit-token`)
      .set('Authorization', 'Bearer t');
    expect(nonParticipantTokenRes.status).toBe(404);

    authAs(userA);
    const endRes = await request(app).post(`/api/v1/calls/${callId}/end`).set('Authorization', 'Bearer t');
    expect(endRes.status).toBe(200);
    expect(endRes.body.status).toBe('ENDED');

    // Final state: the token endpoint refuses once the call has ended.
    authAs(userA);
    const postEndTokenRes = await request(app)
      .post(`/api/v1/calls/${callId}/livekit-token`)
      .set('Authorization', 'Bearer t');
    expect(postEndTokenRes.status).toBe(409);
    expect(postEndTokenRes.body.status).toBe('ENDED');

    // A terminal (ENDED) call is never returned by GET /calls/active.
    authAs(userA);
    const postEndActiveRes = await request(app)
      .get('/api/v1/calls/active')
      .set('Authorization', 'Bearer t');
    expect(postEndActiveRes.status).toBe(200);
    expect(postEndActiveRes.body).toEqual({ call: null });

    // Anti-forgery: a client cannot fake a Call system message (e.g. a fake
    // "Voice call · 99:99") through the ordinary send-message API. The zod
    // schema only allows TEXT/IMAGE/GIF and is .strict() (rejects unknown
    // keys like callId), and senderId always comes from the authenticated
    // user server-side, never the request body.
    authAs(userA);
    const forgeAttempt = await request(app)
      .post(`/api/v1/messages/${match.id}`)
      .set('Authorization', 'Bearer t')
      .send({ content: 'Voice call · 99:99', messageType: 'SYSTEM', callId, senderId: null });
    expect(forgeAttempt.status).toBe(400);

    const messagesForCall = await prisma.message.findMany({ where: { callId } });
    expect(messagesForCall).toHaveLength(1);
    expect(messagesForCall[0].senderId).toBeNull();
  });

  test('POST /calls/:callId/fail over real HTTP: route resolution, whitelist, auth, and post-FAILED lockout', async () => {
    const match = await prisma.match.create({ data: { user1Id: userA.id, user2Id: userB.id } });
    await prisma.callPreference.createMany({
      data: [
        { matchId: match.id, userId: userA.id, audioEnabled: true },
        { matchId: match.id, userId: userB.id, audioEnabled: true },
      ],
    });

    authAs(userA);
    const startRes = await request(app)
      .post(`/api/v1/calls/${match.id}/start`)
      .set('Authorization', 'Bearer t')
      .send({});
    expect(startRes.status).toBe(201);
    const callId = startRes.body.id;

    // Non-whitelisted failureReason is rejected before touching the row.
    authAs(userA);
    const invalidReason = await request(app)
      .post(`/api/v1/calls/${callId}/fail`)
      .set('Authorization', 'Bearer t')
      .send({ failureReason: 'NOT_A_REAL_REASON' });
    expect(invalidReason.status).toBe(400);

    // Non-participant cannot report failure either (existence not leaked).
    authAs(userC);
    const nonParticipantFail = await request(app)
      .post(`/api/v1/calls/${callId}/fail`)
      .set('Authorization', 'Bearer t')
      .send({ failureReason: 'NETWORK_ERROR' });
    expect(nonParticipantFail.status).toBe(404);

    // "fail" must hit this route, not be swallowed by /:callId/accept or any
    // other literal sibling segment — a 200 with status FAILED proves it.
    authAs(userB);
    const failRes = await request(app)
      .post(`/api/v1/calls/${callId}/fail`)
      .set('Authorization', 'Bearer t')
      .send({ failureReason: 'MICROPHONE_DENIED' });
    expect(failRes.status).toBe(200);
    expect(failRes.body.status).toBe('FAILED');
    expect(failRes.body.failureReason).toBe('MICROPHONE_DENIED');

    // FAILED locks out LiveKit credential issuance, same as any other
    // terminal state.
    authAs(userA);
    const tokenAfterFail = await request(app)
      .post(`/api/v1/calls/${callId}/livekit-token`)
      .set('Authorization', 'Bearer t');
    expect(tokenAfterFail.status).toBe(409);
    expect(tokenAfterFail.body.status).toBe('FAILED');

    // GET /calls/active also correctly treats FAILED as no longer active.
    authAs(userA);
    const activeAfterFail = await request(app).get('/api/v1/calls/active').set('Authorization', 'Bearer t');
    expect(activeAfterFail.body).toEqual({ call: null });
  });
});
