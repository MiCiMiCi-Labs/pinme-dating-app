import { AccessToken } from 'livekit-server-sdk';
import { Call, CallStatus, MessageType, Prisma } from '@prisma/client';
import { prisma } from './prisma';

export const CALL_RING_TIMEOUT_MS = 45_000;
export const START_CALL_COOLDOWN_MS = 10_000;
export const INVITATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const LIVEKIT_TOKEN_TTL = '15m';

const ACTIVE_CALL_STATUSES: CallStatus[] = ['RINGING', 'ACCEPTED'];

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

export function buildCallRoomName(callId: string): string {
  return `call:${callId}`;
}

export class CallBusyError extends Error {
  constructor(public readonly reason: 'already_in_call' | 'busy') {
    super(reason);
  }
}

const MAX_START_CALL_ATTEMPTS = 3;

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict / serialization failure detected by Postgres.
    if (error.code === 'P2034') return true;
    // A raw query (our SELECT ... FOR UPDATE) hit a Postgres deadlock
    // (SQLSTATE 40P01). This should be structurally impossible given the
    // fixed ascending-id lock order below, but the retry is cheap insurance.
    const meta = error.meta as { message?: string } | undefined;
    if (error.code === 'P2010' && /deadlock detected/i.test(meta?.message ?? '')) return true;
  }
  return false;
}

// Creates a Call row while holding row-level locks on the caller and callee
// User rows, acquired in a single globally-consistent ascending-id order so
// that no two concurrent start-call transactions can ever form a lock cycle
// (the standard deadlock-avoidance technique). This — not the partial
// unique index on calls.match_id — is what actually guarantees the
// cross-match "one active RINGING/ACCEPTED call per user" invariant: two
// different callers racing to reach the same callee via two different
// matches both attempt to lock that callee's User row, so the second one
// blocks until the first transaction commits, then sees the just-created
// active call in its own busy check and fails with CallBusyError('busy').
// The partial index is a same-match, defense-in-depth backstop only.
export async function createCallWithLocking(params: {
  callId: string;
  matchId: string;
  callerId: string;
  calleeId: string;
  expiresAt: Date;
}): Promise<Call> {
  const { callId, matchId, callerId, calleeId, expiresAt } = params;

  for (let attempt = 1; attempt <= MAX_START_CALL_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const [lockFirst, lockSecond] = [callerId, calleeId].sort();
        await tx.$queryRaw`SELECT id FROM users WHERE id IN (${lockFirst}, ${lockSecond}) ORDER BY id FOR UPDATE`;

        const busyCaller = await tx.call.findFirst({
          where: {
            status: { in: ACTIVE_CALL_STATUSES },
            OR: [{ callerId }, { calleeId: callerId }],
          },
        });
        if (busyCaller) throw new CallBusyError('already_in_call');

        const busyCallee = await tx.call.findFirst({
          where: {
            status: { in: ACTIVE_CALL_STATUSES },
            OR: [{ callerId: calleeId }, { calleeId }],
          },
        });
        if (busyCallee) throw new CallBusyError('busy');

        return tx.call.create({
          data: { id: callId, matchId, callerId, calleeId, roomName: buildCallRoomName(callId), expiresAt },
        });
      });
    } catch (error) {
      if (error instanceof CallBusyError) throw error;
      if (isRetryableTransactionError(error) && attempt < MAX_START_CALL_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error('createCallWithLocking: exhausted retries without a definitive result');
}

export function isActiveStatus(status: CallStatus): boolean {
  return ACTIVE_CALL_STATUSES.includes(status);
}

export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function outcomeMessageContent(call: Call): string | null {
  switch (call.status) {
    case 'ENDED':
      return `Voice call · ${formatDuration(call.durationSec ?? 0)}`;
    case 'MISSED':
      return 'Missed voice call';
    case 'DECLINED':
      return 'Declined voice call';
    case 'CANCELED':
      return 'Canceled voice call';
    case 'FAILED':
      return 'Voice call failed';
    default:
      return null;
  }
}

// Creates the system message for a call's terminal state exactly once,
// keyed by the unique Message.callId column. Safe to call more than once
// for the same call (e.g. a losing side of a race) — the unique constraint
// turns any duplicate attempt into a no-op instead of a duplicate message.
export async function recordCallOutcomeMessage(
  tx: Prisma.TransactionClient,
  call: Call
): Promise<void> {
  const content = outcomeMessageContent(call);
  if (!content) return;

  try {
    await tx.message.create({
      data: {
        matchId: call.matchId,
        senderId: null,
        messageType: MessageType.SYSTEM,
        content,
        callId: call.id,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return;
    }
    throw error;
  }
}

// If `call` is still RINGING but past its expiresAt, atomically transitions
// it to MISSED and records the outcome message. Called at every read/mutate
// entry point (GET /incoming, GET /:callId, accept, start) as a correction
// pass, in addition to the periodic sweeper — see sweepExpiredCalls below.
export async function expireIfStale(call: Call): Promise<Call> {
  if (call.status !== 'RINGING' || call.expiresAt.getTime() > Date.now()) {
    return call;
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.call.updateMany({
      where: { id: call.id, status: 'RINGING' },
      data: { status: 'MISSED', endedAt: new Date() },
    });

    if (result.count === 0) {
      // Someone else (accept/decline/cancel/sweeper) already transitioned it.
      return tx.call.findUniqueOrThrow({ where: { id: call.id } });
    }

    const updated = await tx.call.findUniqueOrThrow({ where: { id: call.id } });
    await recordCallOutcomeMessage(tx, updated);
    return updated;
  });
}

// Periodic sweeper: expiresAt is persisted, so a missed timeout survives
// server restarts/respawns instead of relying on an in-memory setTimeout.
export async function sweepExpiredCalls(): Promise<number> {
  const stale = await prisma.call.findMany({
    where: { status: 'RINGING', expiresAt: { lt: new Date() } },
    select: { id: true },
  });

  for (const { id } of stale) {
    const call = await prisma.call.findUnique({ where: { id } });
    if (call) {
      await expireIfStale(call);
    }
  }

  return stale.length;
}

let sweeperHandle: ReturnType<typeof setInterval> | null = null;

export function startCallSweeper(intervalMs = 15_000): void {
  if (sweeperHandle) return;
  sweeperHandle = setInterval(() => {
    sweepExpiredCalls().catch((error) => {
      console.error('[callSweeper] sweep failed:', error);
    });
  }, intervalMs);
  sweeperHandle.unref?.();
}

export function stopCallSweeper(): void {
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
  }
}

// Forcibly ends any active call between two users, used by the block and
// unmatch hooks. RINGING -> CANCELED, ACCEPTED -> ENDED (with duration).
// Not the acting user's fault, but endedById still records who triggered it
// so the audit trail is complete.
export async function endActiveCallsForPair(
  actingUserId: string,
  otherUserId: string
): Promise<void> {
  const activeCalls = await prisma.call.findMany({
    where: {
      status: { in: ACTIVE_CALL_STATUSES },
      OR: [
        { callerId: actingUserId, calleeId: otherUserId },
        { callerId: otherUserId, calleeId: actingUserId },
      ],
    },
  });

  for (const call of activeCalls) {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const isAccepted = call.status === 'ACCEPTED';
      const result = await tx.call.updateMany({
        where: { id: call.id, status: call.status },
        data: isAccepted
          ? {
              status: 'ENDED',
              endedAt: now,
              endedById: actingUserId,
              durationSec: call.answeredAt
                ? Math.max(0, Math.floor((now.getTime() - call.answeredAt.getTime()) / 1000))
                : 0,
            }
          : {
              status: 'CANCELED',
              endedAt: now,
              endedById: actingUserId,
            },
      });

      if (result.count === 0) return;

      const updated = await tx.call.findUniqueOrThrow({ where: { id: call.id } });
      await recordCallOutcomeMessage(tx, updated);
    });
  }
}

export function assertLiveKitConfigured(): void {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    throw new Error('LiveKit is not configured on this server');
  }
}

export async function issueLiveKitCredentials(params: {
  userId: string;
  userName: string;
  roomName: string;
}): Promise<{ url: string; token: string; roomName: string }> {
  assertLiveKitConfigured();

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: params.userId,
    name: params.userName,
    ttl: LIVEKIT_TOKEN_TTL,
  });

  at.addGrant({
    roomJoin: true,
    room: params.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  return {
    url: LIVEKIT_URL,
    token: await at.toJwt(),
    roomName: params.roomName,
  };
}
