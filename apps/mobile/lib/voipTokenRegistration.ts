// Pure, framework-free helpers for VoIP device token registration/upload/
// rotation (see components/ios-voip-callkit-coordinator.tsx and
// lib/voipPushKit.ts, which re-exports everything here). Deliberately has
// no React/React Native import — lib/voipPushKit.ts itself cannot be
// required outside a React Native/Metro runtime (its top-level `import
// { NativeModules, Platform } from 'react-native'` pulls in RN's own
// Flow-typed entry file), so these decision functions live in their own
// module specifically so they stay unit-testable with plain `node:assert`
// (see voipTokenRegistration.test.js) without a mobile test framework.

// The native bridge (RNVoipPushNotificationManager.m `didUpdatePushCredentials`)
// hex-encodes the raw PKPushCredentials.token bytes with `%02x` — always an
// EVEN-length (one `%02x` pair per byte), lowercase-or-mixed-case hex
// string, never empty (a zero-length credentials.token is filtered out
// natively before the 'register' event is ever emitted). Built from
// repeated 2-hex-digit groups so oddly-lengthed strings (which can never be
// a valid byte-for-byte hex encoding) are rejected, not just non-hex ones.
// Bounds are generous (not hardcoded to exactly 64 chars/32 bytes) since the
// contract is "hex-encoded bytes", not a fixed byte count guaranteed by any
// spec this app controls.
const VOIP_TOKEN_PATTERN = /^(?:[0-9a-f]{2}){8,128}$/i;

export function isValidVoipToken(value: unknown): value is string {
  return typeof value === 'string' && VOIP_TOKEN_PATTERN.test(value);
}

// APNs environment a VoIP token must be uploaded under — SANDBOX for a
// development-signed build (Xcode/EAS "development" profile, incl. its
// simulator variant), PRODUCTION for anything ad-hoc/App-Store-signed (EAS
// "preview"/"production" profiles). Deliberately explicit and audit-able:
// baked into apps/mobile/eas.json's per-profile `env.EXPO_PUBLIC_APNS_ENVIRONMENT`
// (inlined into the JS bundle at build time by Expo's bundler, the same
// mechanism apps/mobile/lib/api.ts already relies on for EXPO_PUBLIC_API_URL)
// — never guessed from `__DEV__`, which is true in Expo Go/dev-client-
// without-EAS-build contexts that have no relationship to which APNs
// environment a real device build's provisioning profile targets.
export type ApnsEnvironment = 'SANDBOX' | 'PRODUCTION';

export function mapApnsEnvironment(raw: string | null | undefined): ApnsEnvironment | null {
  return raw === 'SANDBOX' || raw === 'PRODUCTION' ? raw : null;
}

// Returns null (fail closed) if EXPO_PUBLIC_APNS_ENVIRONMENT wasn't set to
// exactly one of the two valid values for this build — the coordinator must
// then skip upload entirely and log a categorized (never token-containing)
// warning, rather than guessing an environment that could silently send a
// production token to the sandbox APNs endpoint or vice versa.
export function resolveApnsEnvironment(): ApnsEnvironment | null {
  return mapApnsEnvironment(process.env.EXPO_PUBLIC_APNS_ENVIRONMENT);
}

// A single logical "this token belongs to this identity under this
// environment" fact — the unit the coordinator dedupes/tracks pending
// uploads by. `authUserId` is included (not just the token) because the
// device's PushKit token itself does NOT change across login/logout, but
// the backend association it needs re-asserting for a newly logged-in
// identity, so the same token string recurring under a DIFFERENT
// authUserId is a legitimate new event, not a duplicate.
//
// `authUserId` is deliberately `string` (never `null`) — a VoipRegisterEvent
// represents a token already BOUND to a real, resolved identity. The raw
// native token, before any identity is known to bind it to (e.g. arriving
// before auth has restored), is tracked separately as a bare string (see
// the coordinator's latestNativeVoipTokenRef) and never promoted to a
// VoipRegisterEvent — and therefore never entered into pending/upload —
// until a real authUserId is available. This is what a previous version of
// this type (`authUserId: string | null`) failed to make impossible: a
// pending/uploaded event could be constructed with a null identity and
// later silently coerced with `as string`, corrupting ownership,
// rotation, and logout cleanup.
export type VoipRegisterEvent = {
  token: string;
  authUserId: string;
  environment: ApnsEnvironment;
};

export function voipRegisterEventsEqual(a: VoipRegisterEvent | null, b: VoipRegisterEvent): boolean {
  return !!a && a.token === b.token && a.authUserId === b.authUserId && a.environment === b.environment;
}

// ---------------------------------------------------------------------------
// Token <-> identity binding decision (Gate requirement) — pure so the
// cold-start/logout/A->B/token-refresh binding rules are unit-testable
// without a React harness. This is the ENTIRE decision
// components/ios-voip-callkit-coordinator.tsx's
// bindLatestTokenToCurrentIdentity makes before touching any ref; the
// coordinator only carries out whichever action this returns.
// ---------------------------------------------------------------------------

export type VoipTokenBindingInput = {
  // latestNativeVoipTokenRef.current — the most recent validated raw native
  // token, with no identity attached, or null if none has arrived yet.
  latestToken: string | null;
  // The CURRENT live authUserId, or null if logged out/not yet resolved.
  currentAuthUserId: string | null;
  hasAccessToken: boolean;
  // resolveApnsEnvironment()'s result — null means fail-closed (unconfigured
  // build), which must skip exactly like "not logged in" does.
  environment: ApnsEnvironment | null;
  // lastHandledVoipTokenEventRef.current — the last event already
  // bound/entered for upload, used to dedupe a repeat (e.g. a plain token
  // refresh that didn't change authUserId).
  lastHandled: VoipRegisterEvent | null;
};

export type VoipTokenBindingDecision =
  | { action: 'skip' }
  | { action: 'bind'; event: VoipRegisterEvent };

export function resolveVoipTokenBindingDecision(input: VoipTokenBindingInput): VoipTokenBindingDecision {
  if (!input.latestToken) return { action: 'skip' }; // nothing to bind yet
  if (!input.currentAuthUserId) return { action: 'skip' }; // logged out / auth not yet resolved — keep the raw token, never upload
  if (!input.hasAccessToken) return { action: 'skip' };
  if (!input.environment) return { action: 'skip' }; // fail closed — never guess

  const event: VoipRegisterEvent = {
    token: input.latestToken,
    authUserId: input.currentAuthUserId,
    environment: input.environment,
  };
  if (voipRegisterEventsEqual(input.lastHandled, event)) return { action: 'skip' }; // already bound/uploaded — e.g. a plain token refresh
  return { action: 'bind', event };
}

// Token rotation ordering (Gate requirement): the new token must be
// confirmed uploaded BEFORE any attempt to delete the previous one — a
// failed upload must never trigger a delete of the still-only-known-good
// old token, which would leave the user with zero registered devices.
export function shouldDeleteOldVoipToken(input: {
  uploadSucceeded: boolean;
  oldToken: string | null;
  newToken: string;
}): boolean {
  return input.uploadSucceeded && !!input.oldToken && input.oldToken !== input.newToken;
}

// Decides what the "pending upload" slot should hold after an upload
// attempt settles. A failed attempt must never lose track of the token
// (it stays pending for the next backoff retry); a successful attempt only
// clears the slot if it was uploading EXACTLY the event still pending —
// if a newer register event arrived while this attempt was in flight, that
// newer one must survive for its own attempt instead of being silently
// dropped.
export function resolvePendingAfterUploadOutcome(
  pendingBefore: VoipRegisterEvent | null,
  attempted: VoipRegisterEvent,
  succeeded: boolean
): VoipRegisterEvent | null {
  if (!succeeded) return pendingBefore;
  return voipRegisterEventsEqual(pendingBefore, attempted) ? null : pendingBefore;
}

// Ownership marker for the single in-flight upload POST — same
// requestId/generation/authUserId idiom as contexts/call.tsx's AcceptMarker,
// scoped to the coordinator's own identity generation (its generationRef,
// shared with the native call-intent queue). Lets a late-settling attempt
// from a previous identity (A -> B, or the ABA case A -> B -> A) tell "am I
// still the authoritative attempt" apart from "a newer attempt has already
// taken over," without ever clearing a newer attempt's marker.
export type VoipTokenUploadMarker = {
  requestId: number;
  generation: number;
  // Same non-nullable rationale as VoipRegisterEvent.authUserId above — an
  // upload attempt only ever exists for a token already bound to a real
  // identity.
  authUserId: string;
};

export function voipTokenMarkerMatches(
  held: VoipTokenUploadMarker | null,
  mine: VoipTokenUploadMarker
): boolean {
  return (
    !!held &&
    held.requestId === mine.requestId &&
    held.generation === mine.generation &&
    held.authUserId === mine.authUserId
  );
}

// ---------------------------------------------------------------------------
// Post-settle reschedule decision (Gate requirement) — pure so the fix for a
// real "rotation pending stalls forever" race is unit-testable without a
// React harness.
//
// The race: token A is uploading; a register event for token B arrives
// while A is in flight, so pending becomes B, but attemptVoipTokenUpload for
// B dedupes onto A's still-in-flight Promise instead of starting a second
// POST (by design — only one upload in flight at a time). A succeeds;
// resolvePendingAfterUploadOutcome correctly leaves B pending (A's attempt
// wasn't uploading B). A's `finally` releases its own lock — but unless it
// also checks whether something is now pending with nobody in flight to
// upload it, B is left pending forever with no scheduled retry and no
// in-flight attempt to ever pick it up.
// ---------------------------------------------------------------------------

export type VoipTokenSettleRescheduleInput = {
  // pendingVoipTokenRef.current !== null at the moment this attempt's
  // `finally` runs.
  hasPendingToken: boolean;
  // accessTokenRef.current is truthy.
  hasAccessToken: boolean;
  // The pending event's authUserId equals the CURRENT live authUserId —
  // an identity switch mid-flight must not let this settle-handler upload
  // on behalf of whichever identity happens to still be pending.
  pendingOwnerMatchesCurrentAuthUserId: boolean;
  // A retry backoff timer is already scheduled (e.g. this same attempt just
  // failed and scheduled its own retry) — must not be bypassed by an
  // immediate reschedule, which would turn the backoff into a tight loop.
  hasScheduledRetryTimer: boolean;
  // Some OTHER attempt is already recognized as in-flight (voipTokenInFlightRef
  // no longer matches — or never matched — the settling attempt's own
  // marker) — must never start a second concurrent upload.
  hasOtherInFlightUpload: boolean;
};

export function shouldScheduleNextVoipTokenUploadAfterSettle(input: VoipTokenSettleRescheduleInput): boolean {
  return (
    input.hasPendingToken &&
    input.hasAccessToken &&
    input.pendingOwnerMatchesCurrentAuthUserId &&
    !input.hasScheduledRetryTimer &&
    !input.hasOtherInFlightUpload
  );
}
