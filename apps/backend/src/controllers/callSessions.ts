import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma, Call, CallStatus } from '@prisma/client';
import { RoomServiceClient } from 'livekit-server-sdk';
import { prisma } from '../lib/prisma';
import { hasBlockBetween } from '../lib/safety';
import {
  CALL_RING_TIMEOUT_MS,
  START_CALL_COOLDOWN_MS,
  CallBusyError,
  createCallWithLocking,
  expireIfStale,
  issueLiveKitCredentials,
  recordCallOutcomeMessage,
} from '../lib/calls';

async function resolveDbUser(supabaseAuthId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true, name: true },
  });
}

const PHOTO_SELECT = {
  orderBy: [{ isPrimary: 'desc' as const }, { orderIndex: 'asc' as const }],
  take: 1,
  select: { url: true, thumbnailUrl: true },
};

const CALL_PARTICIPANT_SELECT = {
  id: true,
  name: true,
  photos: PHOTO_SELECT,
};

type CallWithParticipants = Call & {
  caller: { id: string; name: string; photos: { url: string; thumbnailUrl: string | null }[] };
  callee: { id: string; name: string; photos: { url: string; thumbnailUrl: string | null }[] };
};

function serializeParticipant(user: CallWithParticipants['caller']) {
  const photo = user.photos[0];
  return {
    id: user.id,
    name: user.name,
    photoUrl: photo ? (photo.thumbnailUrl ?? photo.url) : null,
  };
}

function serializeCall(call: CallWithParticipants) {
  return {
    id: call.id,
    matchId: call.matchId,
    type: call.type,
    status: call.status,
    roomName: call.roomName,
    expiresAt: call.expiresAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    durationSec: call.durationSec,
    failureReason: call.failureReason,
    createdAt: call.createdAt,
    caller: serializeParticipant(call.caller),
    callee: serializeParticipant(call.callee),
  };
}

async function fetchCallWithParticipants(callId: string): Promise<CallWithParticipants | null> {
  return prisma.call.findUnique({
    where: { id: callId },
    include: { caller: { select: CALL_PARTICIPANT_SELECT }, callee: { select: CALL_PARTICIPANT_SELECT } },
  }) as Promise<CallWithParticipants | null>;
}

// Best-effort: close the LiveKit room server-side once a call ends so the
// media session can't linger. Not exercised against a real LiveKit
// deployment in this change, so failures are logged and swallowed rather
// than surfaced to the caller — the Call row's ENDED status is the source
// of truth regardless of whether the room object itself is cleaned up.
async function closeLiveKitRoom(roomName: string): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return;

  try {
    const client = new RoomServiceClient(url, apiKey, apiSecret);
    await client.deleteRoom(roomName);
  } catch (error) {
    console.warn('[calls] failed to close LiveKit room (non-fatal):', error);
  }
}

// ---------------------------------------------------------------------------
// VoIP device tokens
// ---------------------------------------------------------------------------

const registerDeviceSchema = z
  .object({
    token: z.string().min(1),
    platform: z.enum(['IOS', 'ANDROID']),
    environment: z.enum(['SANDBOX', 'PRODUCTION']),
  })
  .strict();

export async function registerVoipDevice(req: Request, res: Response): Promise<void> {
  try {
    const parsed = registerDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { token, platform, environment } = parsed.data;
    const device = await prisma.voipDeviceToken.upsert({
      where: { token },
      create: { userId: dbUser.id, token, platform, environment },
      update: { userId: dbUser.id, platform, environment },
    });

    res.status(201).json({ id: device.id, platform: device.platform, environment: device.environment });
  } catch (error) {
    console.error('[registerVoipDevice] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function unregisterVoipDevice(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const token = req.params.token as string;
    await prisma.voipDeviceToken.deleteMany({ where: { token, userId: dbUser.id } });
    res.status(204).send();
  } catch (error) {
    console.error('[unregisterVoipDevice] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

const startCallSchema = z.object({ type: z.enum(['AUDIO', 'VIDEO']).default('AUDIO') }).strict();

export async function startCall(req: Request, res: Response): Promise<void> {
  try {
    const parsed = startCallSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
      return;
    }

    if (parsed.data.type === 'VIDEO') {
      res.status(400).json({ error: 'Video calling is not supported yet' });
      return;
    }

    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const matchId = req.params.matchId as string;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, user1Id: true, user2Id: true, unmatchedAt: true },
    });

    if (!match || (match.user1Id !== dbUser.id && match.user2Id !== dbUser.id)) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.unmatchedAt) {
      res.status(403).json({ error: 'Match is no longer active' });
      return;
    }

    const calleeId = match.user1Id === dbUser.id ? match.user2Id : match.user1Id;

    if (await hasBlockBetween(dbUser.id, calleeId)) {
      res.status(403).json({ error: 'Call is unavailable' });
      return;
    }

    const [myPref, theirPref] = await Promise.all([
      prisma.callPreference.findUnique({ where: { matchId_userId: { matchId, userId: dbUser.id } } }),
      prisma.callPreference.findUnique({ where: { matchId_userId: { matchId, userId: calleeId } } }),
    ]);

    if (!myPref?.audioEnabled || !theirPref?.audioEnabled) {
      res.status(403).json({ error: 'Voice calling has not been mutually enabled for this match' });
      return;
    }

    const lastCall = await prisma.call.findFirst({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastCall && !['RINGING', 'ACCEPTED'].includes(lastCall.status)) {
      const elapsed = Date.now() - lastCall.createdAt.getTime();
      if (elapsed < START_CALL_COOLDOWN_MS) {
        res.status(429).json({
          error: 'Please wait before calling again',
          retryAfterMs: START_CALL_COOLDOWN_MS - elapsed,
        });
        return;
      }
    }

    const callId = randomUUID();
    const now = new Date();

    try {
      await createCallWithLocking({
        callId,
        matchId,
        callerId: dbUser.id,
        calleeId,
        expiresAt: new Date(now.getTime() + CALL_RING_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof CallBusyError) {
        res.status(409).json({ error: error.reason });
        return;
      }
      // Last-resort backstop: the DB-level partial unique index on
      // (match_id) tripping. Should be unreachable given the row locking in
      // createCallWithLocking, but if application logic elsewhere ever
      // creates a Call outside that helper, this still fails safe.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'A call is already in progress for this match' });
        return;
      }
      throw error;
    }

    const created = await fetchCallWithParticipants(callId);
    res.status(201).json(serializeCall(created!));
  } catch (error) {
    console.error('[startCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getIncomingCalls(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const ringing = await prisma.call.findMany({
      where: { calleeId: dbUser.id, status: 'RINGING' },
      orderBy: { createdAt: 'desc' },
    });

    const stillRinging: Call[] = [];
    for (const call of ringing) {
      const corrected = await expireIfStale(call);
      if (corrected.status === 'RINGING') {
        stillRinging.push(corrected);
      }
    }

    const withParticipants = await Promise.all(
      stillRinging.map((call) => fetchCallWithParticipants(call.id))
    );

    res.json({
      calls: withParticipants.filter((c): c is CallWithParticipants => c !== null).map(serializeCall),
    });
  } catch (error) {
    console.error('[getIncomingCalls] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Recovery endpoint: lets a client that just (re-)initialized — app cold
// start, CallProvider remount, tab/foreground resume — find any RINGING or
// ACCEPTED Call it's a participant in, regardless of caller/callee role.
// GET /incoming only ever surfaces the callee side of a RINGING call; this
// is the only way for a caller's outgoing RINGING call, or either side's
// ACCEPTED call, to be recovered after the client's in-memory state is
// gone. Never returns LiveKit credentials — same rule as GET /:callId,
// fetch those separately via POST /:callId/livekit-token once ACCEPTED is
// observed.
export async function getActiveCall(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const activeCalls = await prisma.call.findMany({
      where: {
        status: { in: ['RINGING', 'ACCEPTED'] },
        OR: [{ callerId: dbUser.id }, { calleeId: dbUser.id }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeCalls.length > 1) {
      // The "one active RINGING/ACCEPTED call per user" invariant
      // (createCallWithLocking's row-locking — see lib/calls.ts) should
      // make this unreachable. If it's ever violated, don't silently pick
      // one and mask a data-integrity bug — fail loudly and safely instead
      // of guessing which call is "the" active one.
      console.error(
        `[getActiveCall] invariant violated: user ${dbUser.id} has ${activeCalls.length} active calls`,
        activeCalls.map((c) => c.id)
      );
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    let call = activeCalls[0];
    if (!call) {
      res.json({ call: null });
      return;
    }

    // Idempotent correction pass, same as GET /:callId and /incoming: a
    // RINGING call past its expiresAt is atomically flipped to MISSED here
    // (not just found stale) before deciding what to return.
    call = await expireIfStale(call);
    if (call.status !== 'RINGING' && call.status !== 'ACCEPTED') {
      res.json({ call: null });
      return;
    }

    const withParticipants = await fetchCallWithParticipants(call.id);
    res.json({ call: serializeCall(withParticipants!) });
  } catch (error) {
    console.error('[getActiveCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Deliberately side-effect-free with respect to LiveKit: this is the
// endpoint a client polls (mobile /incoming and /:callId polling loop per
// the spec's "前台实时信令" section), and re-signing a fresh LiveKit JWT on
// every poll while ACCEPTED would be pointless work and pointless token
// churn. Use POST /:callId/token to actually obtain LiveKit credentials —
// see getCallLiveKitToken below. The only mutation here is expireIfStale,
// which is an idempotent correction (RINGING -> MISSED past expiresAt), not
// a per-request side effect.
export async function getCall(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const callId = req.params.callId as string;
    let call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    call = await expireIfStale(call);

    const withParticipants = await fetchCallWithParticipants(callId);
    res.json(serializeCall(withParticipants!));
  } catch (error) {
    console.error('[getCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// The only endpoint that signs a LiveKit JWT for an already-established
// call. Only valid once ACCEPTED, only for the caller/callee themselves,
// scoped to this call's room only. Callers should fetch this once (e.g.
// when their own GET /:callId poll first observes ACCEPTED) rather than
// calling it on every poll tick.
export async function getCallLiveKitToken(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const callId = req.params.callId as string;
    let call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    call = await expireIfStale(call);

    if (call.status !== 'ACCEPTED') {
      res.status(409).json({
        error: 'LiveKit credentials are only available once the call is accepted',
        status: call.status,
      });
      return;
    }

    const otherId = call.callerId === dbUser.id ? call.calleeId : call.callerId;
    if (await hasBlockBetween(dbUser.id, otherId)) {
      res.status(403).json({ error: 'Call is unavailable' });
      return;
    }

    const livekit = await issueLiveKitCredentials({
      userId: dbUser.id,
      userName: dbUser.name,
      roomName: call.roomName,
    });

    res.json(livekit);
  } catch (error) {
    console.error('[getCallLiveKitToken] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function transitionCall(
  callId: string,
  fromStatus: CallStatus | CallStatus[],
  data: Prisma.CallUpdateManyMutationInput
): Promise<{ updated: boolean; call: Call }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.call.updateMany({
      where: { id: callId, status: Array.isArray(fromStatus) ? { in: fromStatus } : fromStatus },
      data,
    });

    const call = await tx.call.findUniqueOrThrow({ where: { id: callId } });

    if (result.count > 0) {
      await recordCallOutcomeMessage(tx, call);
    }

    return { updated: result.count > 0, call };
  });
}

export async function acceptCall(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const callId = req.params.callId as string;
    let call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.calleeId !== dbUser.id) {
      res.status(403).json({ error: 'Only the callee can accept this call' });
      return;
    }

    call = await expireIfStale(call);

    if (call.status !== 'RINGING') {
      if (call.status === 'ACCEPTED') {
        const withParticipants = await fetchCallWithParticipants(callId);
        res.json(serializeCall(withParticipants!));
        return;
      }
      res.status(409).json({ error: 'Call is no longer available', status: call.status });
      return;
    }

    if (Date.now() > call.expiresAt.getTime()) {
      res.status(409).json({ error: 'Call has expired', status: 'MISSED' });
      return;
    }

    if (await hasBlockBetween(call.callerId, call.calleeId)) {
      await transitionCall(callId, 'RINGING', {
        status: 'CANCELED',
        endedAt: new Date(),
        endedById: dbUser.id,
      });
      res.status(403).json({ error: 'Call is unavailable' });
      return;
    }

    const { updated, call: transitioned } = await transitionCall(callId, 'RINGING', {
      status: 'ACCEPTED',
      answeredAt: new Date(),
    });

    if (!updated && transitioned.status !== 'ACCEPTED') {
      res.status(409).json({ error: 'Call is no longer available', status: transitioned.status });
      return;
    }

    // Accept is a pure state transition (RINGING -> ACCEPTED) and nothing
    // else. LiveKit credentials are never issued or returned here — a client
    // that observes ACCEPTED (via this response, a GET /:callId poll, or
    // Realtime) must call POST /:callId/livekit-token separately. This keeps
    // "the callee has accepted" durable in the DB even if credential
    // issuance fails or is slow, instead of coupling a single HTTP request's
    // success to both the state transition and an external LiveKit call.
    const withParticipants = await fetchCallWithParticipants(callId);
    res.json(serializeCall(withParticipants!));
  } catch (error) {
    console.error('[acceptCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function respondToRingingCall(
  req: Request,
  res: Response,
  role: 'caller' | 'callee',
  nextStatus: 'DECLINED' | 'CANCELED'
): Promise<void> {
  const dbUser = await resolveDbUser(req.userId!);
  if (!dbUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const callId = req.params.callId as string;
  let call = await prisma.call.findUnique({ where: { id: callId } });
  if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }

  const expectedUserId = role === 'callee' ? call.calleeId : call.callerId;
  if (expectedUserId !== dbUser.id) {
    res.status(403).json({ error: `Only the ${role} can perform this action` });
    return;
  }

  call = await expireIfStale(call);

  if (call.status !== 'RINGING') {
    if (call.status === nextStatus) {
      const withParticipants = await fetchCallWithParticipants(callId);
      res.json(serializeCall(withParticipants!));
      return;
    }
    res.status(409).json({ error: 'Call is no longer available', status: call.status });
    return;
  }

  const { updated, call: transitioned } = await transitionCall(callId, 'RINGING', {
    status: nextStatus,
    endedAt: new Date(),
    endedById: dbUser.id,
  });

  if (!updated && transitioned.status !== nextStatus) {
    res.status(409).json({ error: 'Call is no longer available', status: transitioned.status });
    return;
  }

  const withParticipants = await fetchCallWithParticipants(callId);
  res.json(serializeCall(withParticipants!));
}

export async function declineCall(req: Request, res: Response): Promise<void> {
  try {
    await respondToRingingCall(req, res, 'callee', 'DECLINED');
  } catch (error) {
    console.error('[declineCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function cancelCall(req: Request, res: Response): Promise<void> {
  try {
    await respondToRingingCall(req, res, 'caller', 'CANCELED');
  } catch (error) {
    console.error('[cancelCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function endCall(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const callId = req.params.callId as string;
    const call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    if (call.status === 'ENDED') {
      const withParticipants = await fetchCallWithParticipants(callId);
      res.json(serializeCall(withParticipants!));
      return;
    }

    if (call.status !== 'ACCEPTED') {
      res.status(409).json({ error: 'Call is not active', status: call.status });
      return;
    }

    const now = new Date();
    const durationSec = call.answeredAt
      ? Math.max(0, Math.floor((now.getTime() - call.answeredAt.getTime()) / 1000))
      : 0;

    const { updated, call: transitioned } = await transitionCall(callId, 'ACCEPTED', {
      status: 'ENDED',
      endedAt: now,
      endedById: dbUser.id,
      durationSec,
    });

    if (!updated && transitioned.status !== 'ENDED') {
      res.status(409).json({ error: 'Call is not active', status: transitioned.status });
      return;
    }

    await closeLiveKitRoom(transitioned.roomName);

    const withParticipants = await fetchCallWithParticipants(callId);
    res.json(serializeCall(withParticipants!));
  } catch (error) {
    console.error('[endCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Whitelisted client-reportable failure reasons. Anything else is a 400 —
// the column itself is a free-text `String?` (no DB enum), so this zod
// schema is the only thing standing between an arbitrary client string and
// what gets persisted.
const failCallSchema = z
  .object({
    failureReason: z.enum(['MICROPHONE_DENIED', 'LIVEKIT_CONNECTION_FAILED', 'NETWORK_ERROR']),
  })
  .strict();

// Lets a client report that its own media/connection setup failed — e.g. a
// denied microphone permission, or a LiveKit connection that never
// established or that dropped for good after reconnect attempts were
// exhausted. Reachable from RINGING (a callee never even got as far as
// accepting) or ACCEPTED (media failed after the call was live). Never
// trusts anything from the client beyond the whitelisted failureReason —
// callerId, roomName, and duration all come from the Call row itself.
export async function failCall(req: Request, res: Response): Promise<void> {
  try {
    const parsed = failCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const callId = req.params.callId as string;
    let call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call || (call.callerId !== dbUser.id && call.calleeId !== dbUser.id)) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    call = await expireIfStale(call);

    if (call.status === 'FAILED') {
      // Idempotent: a retried fail report (e.g. after a dropped response)
      // must not produce a second system message or a 409.
      const withParticipants = await fetchCallWithParticipants(callId);
      res.json(serializeCall(withParticipants!));
      return;
    }

    if (call.status !== 'RINGING' && call.status !== 'ACCEPTED') {
      // Already DECLINED/CANCELED/MISSED/ENDED — a genuinely different
      // terminal outcome already won; FAILED must never overwrite it.
      res.status(409).json({ error: 'Call is no longer available', status: call.status });
      return;
    }

    const { updated, call: transitioned } = await transitionCall(callId, ['RINGING', 'ACCEPTED'], {
      status: 'FAILED',
      failureReason: parsed.data.failureReason,
      endedAt: new Date(),
      endedById: dbUser.id,
    });

    if (!updated) {
      if (transitioned.status === 'FAILED') {
        const withParticipants = await fetchCallWithParticipants(callId);
        res.json(serializeCall(withParticipants!));
        return;
      }
      res.status(409).json({ error: 'Call is no longer available', status: transitioned.status });
      return;
    }

    // Best-effort only — the DB transition above already committed, so a
    // failure here never rolls back the FAILED status.
    await closeLiveKitRoom(transitioned.roomName);

    const withParticipants = await fetchCallWithParticipants(callId);
    res.json(serializeCall(withParticipants!));
  } catch (error) {
    console.error('[failCall] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
