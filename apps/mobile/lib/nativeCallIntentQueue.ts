// Pure, framework-free helpers for the iOS PushKit/CallKit JS runtime
// coordinator (see components/ios-voip-callkit-coordinator.tsx) — payload
// validation and a bounded, deduped, FIFO pending-intent queue for native
// events that arrive before Supabase auth has been restored (cold start).
//
// Deliberately has no React/React Native import so it can be unit-tested
// with plain `node:assert` (see nativeCallIntentQueue.test.js) without a
// mobile test framework.

export type NativeCallIntentType = 'incoming' | 'answer' | 'end';

// What a CallProvider native-intent handler (handleNativeIncoming/
// handleNativeAnswer/handleNativeEnd) reports back to the coordinator:
//   - 'handled': the server has been read AFTER the action (if any) was
//     attempted, and its status now authoritatively reflects the outcome
//     (ACCEPTED for answer, a terminal status for end/already-terminal) —
//     nothing further to do for this entry. Never returned just because an
//     action Promise resolved without throwing.
//   - 'retry': no auth yet, a transient network failure (either the initial
//     GET or the post-action confirmation GET), or the server still shows
//     RINGING/ACCEPTED after the action was attempted (i.e. it never
//     landed) — re-attempt later; a re-run safely re-sends the same
//     idempotent accept/decline/cancel/end.
//   - 'discarded': invalid callId, 404/non-participant, the call is already
//     terminal before any action was attempted and cleanup is done, or the
//     session identity (recoveryGenerationRef) changed while this intent
//     was in flight — never retry.
export type NativeCallIntentResult = 'handled' | 'retry' | 'discarded';

export type NativeCallIntentQueueEntry = {
  type: NativeCallIntentType;
  callId: string;
  enqueuedAt: number; // ms epoch, Date.now() at enqueue time
};

export const MAX_QUEUE_LENGTH = 16;
export const ENTRY_TTL_MS = 30_000;
// Bounded exponential backoff for 'retry' results — never a 0ms tight loop,
// and capped so a prolonged outage still only retries a few times a minute.
export const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];
export const MAX_RETRY_BACKOFF_MS = RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];

// ---------------------------------------------------------------------------
// UUID / payload validation
// ---------------------------------------------------------------------------

// Matches the same acceptance criteria as the native bridge's own
// `[[NSUUID alloc] initWithUUIDString:]` check (see
// apps/mobile/plugins/withVoipPushKit.js) — any correctly-formatted
// 8-4-4-4-12 hex UUID, not restricted to a specific version/variant. Kept
// in sync deliberately: the native side and this JS side must agree on what
// counts as a "legal UUID" for the same callId.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidCallId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

// Extracts and validates the callId out of a PushKit `notification` event
// payload, which (per the backend's actual payload shape — see
// apps/backend/src/lib/apnsVoip.ts) carries the same Call.id under BOTH
// `uuid` and `callId` keys. If both are present they must agree; a mismatch
// is treated as invalid rather than trusting either one.
export function extractIncomingCallId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const uuid = record.uuid;
  const callId = record.callId;

  const hasUuid = uuid !== undefined && uuid !== null;
  const hasCallId = callId !== undefined && callId !== null;

  if (hasUuid && hasCallId) {
    if (uuid !== callId) return null; // disagreement — refuse to guess which is right
    return isValidCallId(uuid) ? (uuid as string) : null;
  }
  if (hasUuid) return isValidCallId(uuid) ? (uuid as string) : null;
  if (hasCallId) return isValidCallId(callId) ? (callId as string) : null;
  return null;
}

// ---------------------------------------------------------------------------
// Pending intent queue — pure array operations, no timers/mutation of
// anything outside the array itself. The caller (coordinator) owns the
// actual ref/state and timer scheduling.
// ---------------------------------------------------------------------------

// Only 'incoming' entries are time-limited: a stale, never-displayed
// incoming-call hint stops being worth acting on after ENTRY_TTL_MS. 'answer'
// and 'end' represent something the user already did on the system CallKit
// UI — they must NOT be silently dropped just because a network outage kept
// them queued past the TTL; they stay queued (bounded only by
// MAX_QUEUE_LENGTH and identity/generation invalidation, see the
// coordinator) until a fresh REST read can confirm what actually happened.
export function isEntryExpired(entry: NativeCallIntentQueueEntry, now: number, ttlMs = ENTRY_TTL_MS): boolean {
  if (entry.type !== 'incoming') return false;
  return now - entry.enqueuedAt > ttlMs;
}

export type ExpiredIncomingDisposition = 'silent-drop' | 'close-stale-callkit';

// Decides what to do when an 'incoming' entry has expired. If the SAME
// callId also has a queued 'answer' or 'end' entry (the user already acted
// on CallKit's system UI before this stale incoming hint got processed),
// the incoming entry must be dropped silently — closing native CallKit here
// would tear down the very call the queued answer/end is about to act on.
// Otherwise this is a genuinely stale, never-answered incoming call: safe to
// tell CallKit to close its display for it.
export function resolveExpiredIncomingDisposition(
  remainingQueue: readonly NativeCallIntentQueueEntry[],
  expiredEntry: NativeCallIntentQueueEntry
): ExpiredIncomingDisposition {
  const hasFollowingAction = remainingQueue.some(
    other => other.callId === expiredEntry.callId && (other.type === 'answer' || other.type === 'end')
  );
  return hasFollowingAction ? 'silent-drop' : 'close-stale-callkit';
}

// Enqueues `entry`, deduping on (callId, type): a pre-existing entry for the
// same call + same intent type is dropped and replaced by the new one at
// the back of the queue (answer and end are different types and therefore
// never dedup against each other). Caps the queue length by dropping the
// OLDEST entries first — a call intent's relevance decays fast, so under
// sustained overflow the most recent events are the ones worth keeping.
export function enqueueDeduped(
  queue: readonly NativeCallIntentQueueEntry[],
  entry: NativeCallIntentQueueEntry,
  maxLength = MAX_QUEUE_LENGTH
): NativeCallIntentQueueEntry[] {
  const withoutDuplicate = queue.filter(existing => !(existing.callId === entry.callId && existing.type === entry.type));
  const next = [...withoutDuplicate, entry];
  if (next.length <= maxLength) return next;
  return next.slice(next.length - maxLength);
}

// Removes every entry for `callId` — used when a call is discovered to be
// terminal/invalid and any other still-queued intents for it are moot.
export function removeEntriesForCallId(
  queue: readonly NativeCallIntentQueueEntry[],
  callId: string
): NativeCallIntentQueueEntry[] {
  return queue.filter(entry => entry.callId !== callId);
}

export function retryBackoffMs(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, RETRY_BACKOFF_MS.length - 1));
  return RETRY_BACKOFF_MS[index];
}

// ---------------------------------------------------------------------------
// Auth session-boundary decision — pure so the "cold-start queue must
// survive the initial session restore, but a REAL post-init login/
// logout/switch must invalidate it" logic (see
// components/ios-voip-callkit-coordinator.tsx) is unit-testable without a
// React harness. The component owns all the actual ref mutations; this only
// decides WHICH transition just happened.
// ---------------------------------------------------------------------------

export type AuthIdentitySnapshot = {
  // Whether AuthProvider's initial getSession()/onAuthStateChange settling
  // has already resolved at least once (ref state BEFORE this call).
  authInitialized: boolean;
  // The identity (Supabase session.user.id, or null if logged out) recorded
  // the last time this function decided 'baseline' or 'invalidate'.
  previousAuthUserId: string | null;
  // AuthContext's own `loading` — true means the initial session restore is
  // still in flight (native events must keep queuing untouched).
  authLoading: boolean;
  // AuthContext's current session.user.id, or null if logged out.
  authUserId: string | null;
};

export type AuthIdentityDecision =
  // Initial restore still pending — do nothing (queue keeps accumulating).
  | { action: 'wait' }
  // First-ever resolution of the initial restore. NOT a login/logout/switch
  // (there was no real "previous" identity to compare against) — the queue
  // and any in-flight drain must be left untouched.
  | { action: 'baseline'; authUserId: string | null }
  // Resolved, and the identity is unchanged since the last decision.
  | { action: 'noop' }
  // A real post-initialization login, logout, or account switch — the
  // queue/generation/timers must be invalidated.
  | { action: 'invalidate'; authUserId: string | null };

export function decideAuthIdentityTransition(snapshot: AuthIdentitySnapshot): AuthIdentityDecision {
  if (snapshot.authLoading) return { action: 'wait' };
  if (!snapshot.authInitialized) return { action: 'baseline', authUserId: snapshot.authUserId };
  if (snapshot.previousAuthUserId === snapshot.authUserId) return { action: 'noop' };
  return { action: 'invalidate', authUserId: snapshot.authUserId };
}

// ---------------------------------------------------------------------------
// Native answer/end post-action confirmation resolution — pure mapping from
// "what did the authoritative confirmation GET (or its failure) show" to the
// NativeCallIntentResult contexts/call.tsx's handleNativeAnswer/
// handleNativeEnd report back. Kept status-string-agnostic (booleans derived
// from CallSummary.status by the caller) so this module stays free of any
// @/lib/api import. Extracted specifically so "answer/end only report
// 'handled' once the server confirms it, and a double POST+GET failure
// reports 'retry'" is unit-testable without a React harness.
// ---------------------------------------------------------------------------

export type ServerConfirmation =
  | { networkError: true }
  | { networkError: false; serverIsTerminal: boolean; serverConfirmsAccepted?: boolean };

// answer: 'handled' only once the server confirms ACCEPTED (the accept
// landed) or a terminal status (it never landed, but the call is over some
// other way and there's nothing left to retry) — otherwise (still RINGING,
// or the confirmation read itself failed) 'retry', so the coordinator
// safely re-sends the same idempotent accept later.
export function resolveAnswerConfirmation(confirmation: ServerConfirmation): NativeCallIntentResult {
  if (confirmation.networkError) return 'retry';
  if (confirmation.serverConfirmsAccepted) return 'handled';
  if (confirmation.serverIsTerminal) return 'handled';
  return 'retry';
}

// end (decline/cancel/end): 'handled' only once the server confirms a
// terminal status — otherwise (still RINGING/ACCEPTED, meaning the action
// never landed, or the confirmation read itself failed) 'retry', so the
// coordinator safely re-sends the same idempotent decline/cancel/end later.
export function resolveEndConfirmation(confirmation: ServerConfirmation): NativeCallIntentResult {
  if (confirmation.networkError) return 'retry';
  return confirmation.serverIsTerminal ? 'handled' : 'retry';
}

// ---------------------------------------------------------------------------
// Drain-exit reschedule decision — pure so the fix for a real stranded-queue
// race is unit-testable without a React harness (see
// components/ios-voip-callkit-coordinator.tsx's drainQueue).
//
// The race: while drainQueue is mid-await for an OLD generation's entry
// (drainingRef true), an identity switch bumps generationRef and clears the
// queue; a subsequent enqueue for the NEW generation calls scheduleDrain(0),
// but that timer fires immediately and no-ops because drainingRef is still
// true. When the old await finally resolves, the while loop notices the
// generation mismatch and returns, and the `finally` block clears
// drainingRef — but nothing else was left to pick the new generation's
// now-nonempty queue back up, stranding it indefinitely. This function is
// what the `finally` block consults right after clearing drainingRef to
// decide whether it must schedule one itself.
// ---------------------------------------------------------------------------

export type DrainExitRescheduleInput = {
  // queueRef.current.length at the moment drainingRef is cleared.
  queueLength: number;
  // accessTokenRef.current truthiness — logged out (no token) must never
  // keep scheduling drains that can only no-op.
  hasAccessToken: boolean;
  // drainTimerRef.current !== null — a drain is already scheduled (e.g. a
  // 'retry' backoff, or a fresh enqueue that landed AFTER drainingRef
  // cleared), so scheduling a second one would only risk a concurrent
  // drain attempt.
  hasScheduledTimer: boolean;
};

export function shouldRescheduleDrainAfterExit(input: DrainExitRescheduleInput): boolean {
  return input.queueLength > 0 && input.hasAccessToken && !input.hasScheduledTimer;
}
