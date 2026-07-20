// Plain Node script (no test framework) verifying voipTokenRegistration.ts's
// pure functions. Run from apps/mobile (PowerShell — Windows PowerShell 5.1
// has no inline VAR=value syntax, so the env vars are set as separate
// statements first; this is the same reproducible command already
// established for lib/nativeCallIntentQueue.test.js):
//
//   cd apps/mobile
//   $env:TS_NODE_TRANSPILE_ONLY='true'
//   $env:TS_NODE_SKIP_PROJECT='true'
//   $env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
//   node -r ts-node/register lib/voipTokenRegistration.test.js
//
// (bash/zsh equivalent: TS_NODE_TRANSPILE_ONLY=true TS_NODE_SKIP_PROJECT=true
// TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
// node -r ts-node/register lib/voipTokenRegistration.test.js)
//
// TS_NODE_SKIP_PROJECT is load-bearing: without it, ts-node picks up this
// package's own tsconfig.json (extends expo/tsconfig.base), whose
// bundler-oriented moduleResolution/customConditions settings conflict with
// the CommonJS output ts-node needs for a plain `node -r` require() —
// skipping the project file and supplying the minimal CommonJS/Node options
// above avoids that fight. ts-node is already an existing hoisted
// devDependency in this monorepo — nothing new installed for this test.
//
// This module (not lib/voipPushKit.ts, which re-exports it) is what's
// required directly: voipPushKit.ts has a top-level `import ... from
// 'react-native'`, and react-native's own entry file uses Flow-typed import
// syntax that crashes under plain ts-node/CommonJS outside a Metro runtime
// (confirmed by trying it) — voipTokenRegistration.ts has no such import.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  isValidVoipToken,
  mapApnsEnvironment,
  resolveApnsEnvironment,
  voipRegisterEventsEqual,
  resolveVoipTokenBindingDecision,
  shouldDeleteOldVoipToken,
  resolvePendingAfterUploadOutcome,
  shouldScheduleNextVoipTokenUploadAfterSettle,
  voipTokenMarkerMatches,
} = require('./voipTokenRegistration.ts');

const HEX_TOKEN_A = '0123456789abcdef'.repeat(4); // 64 hex chars — a realistic, valid device token
const HEX_TOKEN_B = 'fedcba9876543210'.repeat(4); // 64 hex chars, distinct from HEX_TOKEN_A

function testIsValidVoipToken() {
  assert.strictEqual(isValidVoipToken(HEX_TOKEN_A), true);
  assert.strictEqual(isValidVoipToken(HEX_TOKEN_A.toUpperCase()), true, 'case-insensitive');
  assert.strictEqual(isValidVoipToken(''), false, 'empty string rejected');
  assert.strictEqual(isValidVoipToken(null), false);
  assert.strictEqual(isValidVoipToken(undefined), false);
  assert.strictEqual(isValidVoipToken(12345), false, 'non-string rejected');
  assert.strictEqual(isValidVoipToken({}), false);
  assert.strictEqual(isValidVoipToken('not-hex-at-all'), false);
  assert.strictEqual(isValidVoipToken('short'), false, 'too short to be a real device token');
  assert.strictEqual(isValidVoipToken('zzzz1234zzzz1234zzzz1234zzzz1234'), false, 'contains non-hex characters');
  // Odd-length hex can never be a valid byte-for-byte %02x encoding.
  assert.strictEqual(isValidVoipToken(HEX_TOKEN_A.slice(0, -1)), false, 'odd-length hex rejected (63 chars)');
  assert.strictEqual(isValidVoipToken('abc'), false, 'odd-length hex rejected (3 chars, otherwise well-formed)');
  assert.strictEqual(
    isValidVoipToken(HEX_TOKEN_A + 'a'),
    false,
    'odd-length hex rejected (65 chars, otherwise well-formed)'
  );
}

function testMapApnsEnvironment() {
  assert.strictEqual(mapApnsEnvironment('SANDBOX'), 'SANDBOX');
  assert.strictEqual(mapApnsEnvironment('PRODUCTION'), 'PRODUCTION');
  assert.strictEqual(mapApnsEnvironment('sandbox'), null, 'case-sensitive — never guess');
  assert.strictEqual(mapApnsEnvironment('development'), null, 'not a recognized value');
  assert.strictEqual(mapApnsEnvironment(undefined), null, 'unset -> fail closed');
  assert.strictEqual(mapApnsEnvironment(null), null);
  assert.strictEqual(mapApnsEnvironment(''), null);
}

function testResolveApnsEnvironment() {
  const original = process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
  try {
    delete process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
    assert.strictEqual(resolveApnsEnvironment(), null, 'unset env var -> fail closed, never guessed');

    process.env.EXPO_PUBLIC_APNS_ENVIRONMENT = 'SANDBOX';
    assert.strictEqual(resolveApnsEnvironment(), 'SANDBOX');

    process.env.EXPO_PUBLIC_APNS_ENVIRONMENT = 'PRODUCTION';
    assert.strictEqual(resolveApnsEnvironment(), 'PRODUCTION');

    process.env.EXPO_PUBLIC_APNS_ENVIRONMENT = 'garbage';
    assert.strictEqual(resolveApnsEnvironment(), null, 'unrecognized value -> fail closed');
  } finally {
    if (original === undefined) delete process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
    else process.env.EXPO_PUBLIC_APNS_ENVIRONMENT = original;
  }
}

function testVoipRegisterEventsEqual() {
  const eventA = { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' };
  const eventASameFields = { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' };
  assert.strictEqual(voipRegisterEventsEqual(eventA, eventASameFields), true);
  assert.strictEqual(voipRegisterEventsEqual(null, eventA), false);

  // Same token, different user -> NOT a duplicate (the device token itself
  // doesn't change across login/logout, but the backend association does
  // need re-asserting for the new identity).
  const eventUserB = { ...eventA, authUserId: 'user-B' };
  assert.strictEqual(voipRegisterEventsEqual(eventA, eventUserB), false);

  // Same user, different token (rotation) -> not a duplicate.
  const eventNewToken = { ...eventA, token: HEX_TOKEN_B };
  assert.strictEqual(voipRegisterEventsEqual(eventA, eventNewToken), false);

  // Same token/user, different environment -> not a duplicate.
  const eventProd = { ...eventA, environment: 'PRODUCTION' };
  assert.strictEqual(voipRegisterEventsEqual(eventA, eventProd), false);
}

// --- resolveVoipTokenBindingDecision: the cold-start/logout/A->B/token-
// refresh binding rules (Gate blockers 1 & 2) ---------------------------

function testColdStartTokenBindsToRealUserNotNull() {
  // Token arrives while identity is not yet known: nothing to bind to yet
  // (this is what the coordinator's handleVoipTokenEvent hits before auth
  // restores) — must skip, never produce an authUserId: null event (the
  // VoipRegisterEvent type doesn't even allow that anymore).
  const whileUnknown = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: null,
    hasAccessToken: false,
    environment: 'SANDBOX',
    lastHandled: null,
  });
  assert.deepStrictEqual(whileUnknown, { action: 'skip' });

  // Auth resolves to a real user A — the SAME latest token must now bind to
  // A, not be lost or bound to null.
  const onceAReady = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: 'user-A',
    hasAccessToken: true,
    environment: 'SANDBOX',
    lastHandled: null,
  });
  assert.deepStrictEqual(onceAReady, {
    action: 'bind',
    event: { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' },
  });
}

function testLogoutThenNewUserRebindsSameLatestToken() {
  // A was bound/uploaded; then logout — lastHandled is cleared by the
  // identity-invalidate effect, but latestNativeVoipTokenRef (modeled here
  // as `latestToken`) survives untouched.
  const lastHandledForA = { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' };

  const duringLogout = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: null,
    hasAccessToken: false,
    environment: 'SANDBOX',
    lastHandled: null, // cleared by the identity effect
  });
  assert.deepStrictEqual(duringLogout, { action: 'skip' }, 'logged out -> must not upload');

  // B logs in — the SAME latest token (never cleared) must rebind under B.
  const onceBReady = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: 'user-B',
    hasAccessToken: true,
    environment: 'SANDBOX',
    lastHandled: null,
  });
  assert.deepStrictEqual(onceBReady, {
    action: 'bind',
    event: { token: HEX_TOKEN_A, authUserId: 'user-B', environment: 'SANDBOX' },
  });
  assert.notDeepStrictEqual(onceBReady.event, lastHandledForA, "B's event must be its own, not A's stale one");
}

function testLogoutDoesNotUpload() {
  const decision = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: null,
    hasAccessToken: false,
    environment: 'SANDBOX',
    lastHandled: { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' },
  });
  assert.deepStrictEqual(decision, { action: 'skip' });
}

function testTokenRefreshSameUserSameTokenDoesNotReupload() {
  const alreadyBound = { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' };
  // A plain Supabase access-token refresh: authUserId unchanged, same native
  // token, hasAccessToken still true (new token value, but that's not part
  // of this decision's inputs) -> must be recognized as already handled.
  const decision = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: 'user-A',
    hasAccessToken: true,
    environment: 'SANDBOX',
    lastHandled: alreadyBound,
  });
  assert.deepStrictEqual(decision, { action: 'skip' }, 'must not re-bind/re-upload an already-handled (user, token) pair');
}

function testFailClosedEnvironmentSkipsEvenWhenIdentityReady() {
  const decision = resolveVoipTokenBindingDecision({
    latestToken: HEX_TOKEN_A,
    currentAuthUserId: 'user-A',
    hasAccessToken: true,
    environment: null, // unconfigured build
    lastHandled: null,
  });
  assert.deepStrictEqual(decision, { action: 'skip' });
}

function testShouldDeleteOldVoipToken() {
  // Upload succeeded, distinct old token -> delete the old one.
  assert.strictEqual(
    shouldDeleteOldVoipToken({ uploadSucceeded: true, oldToken: HEX_TOKEN_A, newToken: HEX_TOKEN_B }),
    true
  );
  // Upload FAILED -> must never delete the old token, regardless of anything else.
  assert.strictEqual(
    shouldDeleteOldVoipToken({ uploadSucceeded: false, oldToken: HEX_TOKEN_A, newToken: HEX_TOKEN_B }),
    false
  );
  // No old token on record -> nothing to delete.
  assert.strictEqual(
    shouldDeleteOldVoipToken({ uploadSucceeded: true, oldToken: null, newToken: HEX_TOKEN_B }),
    false
  );
  // Old token and new token are identical (no real rotation) -> nothing to delete.
  assert.strictEqual(
    shouldDeleteOldVoipToken({ uploadSucceeded: true, oldToken: HEX_TOKEN_A, newToken: HEX_TOKEN_A }),
    false
  );
}

function testResolvePendingAfterUploadOutcome() {
  const attempted = { token: HEX_TOKEN_A, authUserId: 'user-A', environment: 'SANDBOX' };

  // Failure must retain the pending token exactly as it was, no matter what
  // it was, so the next backoff retry still has something to upload.
  assert.deepStrictEqual(resolvePendingAfterUploadOutcome(attempted, attempted, false), attempted);
  assert.strictEqual(resolvePendingAfterUploadOutcome(null, attempted, false), null);

  // Success clears the slot only if pending was EXACTLY what was attempted.
  assert.strictEqual(resolvePendingAfterUploadOutcome(attempted, attempted, true), null);

  // Success, but a NEWER register event arrived while this attempt was in
  // flight (pending no longer matches what was attempted) -> the newer
  // pending event must survive for its own attempt, not be dropped.
  const newerPending = { token: HEX_TOKEN_B, authUserId: 'user-A', environment: 'SANDBOX' };
  assert.deepStrictEqual(resolvePendingAfterUploadOutcome(newerPending, attempted, true), newerPending);
}

function testVoipTokenMarkerMatches() {
  const markerA1 = { requestId: 1, generation: 1, authUserId: 'user-A' };

  // Exact match.
  assert.strictEqual(voipTokenMarkerMatches(markerA1, markerA1), true);
  assert.strictEqual(voipTokenMarkerMatches({ ...markerA1 }, markerA1), true);
  // Nothing held -> never matches.
  assert.strictEqual(voipTokenMarkerMatches(null, markerA1), false);

  // A -> B: different generation AND different authUserId -> must not match.
  const markerB2 = { requestId: 2, generation: 2, authUserId: 'user-B' };
  assert.strictEqual(voipTokenMarkerMatches(markerA1, markerB2), false);

  // A -> B -> A (ABA): a new marker for "A" again must carry a NEW
  // generation/requestId — the stale first-A marker must not match the
  // second-A marker even though authUserId string is identical.
  const markerA3 = { requestId: 3, generation: 3, authUserId: 'user-A' };
  assert.strictEqual(voipTokenMarkerMatches(markerA1, markerA3), false, 'ABA case must not be treated as still-current');
}

// Simulates the exact "late finally must not clear a newer request's lock"
// sequence at the logical level these pure functions operate on (the real
// ref/timer interplay lives in the React coordinator and is not exercised
// here):
//   1. Attempt #1 (user A, requestId=1, generation=1) takes the lock.
//   2. Identity switches: generation bumps to 2, lock is cleared by the
//      identity effect (modeled as `heldLock = null`).
//   3. Attempt #2 (user B, requestId=2, generation=2) takes the lock.
//   4. Attempt #1's `finally` finally runs and must decide whether to clear
//      the lock — it must NOT, since the lock no longer holds its marker.
function testStaleFinallyDoesNotClearNewerLock() {
  const marker1 = { requestId: 1, generation: 1, authUserId: 'user-A' };
  let heldLock = marker1; // step 1

  heldLock = null; // step 2: identity effect invalidates on switch

  const marker2 = { requestId: 2, generation: 2, authUserId: 'user-B' };
  heldLock = marker2; // step 3: attempt #2 takes over

  // step 4: attempt #1's finally decides using the SAME marker-matches
  // check the real coordinator uses.
  const attempt1MayClear = voipTokenMarkerMatches(heldLock, marker1);
  assert.strictEqual(attempt1MayClear, false, "attempt #1's late finally must not clear attempt #2's lock");
  if (attempt1MayClear) heldLock = null;

  assert.deepStrictEqual(heldLock, marker2, "attempt #2's lock must survive attempt #1's late finally");
}

// --- shouldScheduleNextVoipTokenUploadAfterSettle: rotation-pending
// stall fix (Gate blocker 3) ---------------------------------------------

function testShouldScheduleNextVoipTokenUploadAfterSettle() {
  const allClear = {
    hasPendingToken: true,
    hasAccessToken: true,
    pendingOwnerMatchesCurrentAuthUserId: true,
    hasScheduledRetryTimer: false,
    hasOtherInFlightUpload: false,
  };
  assert.strictEqual(shouldScheduleNextVoipTokenUploadAfterSettle(allClear), true);

  assert.strictEqual(
    shouldScheduleNextVoipTokenUploadAfterSettle({ ...allClear, hasPendingToken: false }),
    false,
    'nothing pending -> nothing to schedule'
  );
  assert.strictEqual(
    shouldScheduleNextVoipTokenUploadAfterSettle({ ...allClear, hasAccessToken: false }),
    false,
    'no auth -> must not schedule a call that can only fail'
  );
  assert.strictEqual(
    shouldScheduleNextVoipTokenUploadAfterSettle({ ...allClear, pendingOwnerMatchesCurrentAuthUserId: false }),
    false,
    'pending belongs to a superseded identity -> must not upload on its behalf'
  );
  assert.strictEqual(
    shouldScheduleNextVoipTokenUploadAfterSettle({ ...allClear, hasScheduledRetryTimer: true }),
    false,
    'a backoff retry is already scheduled -> must not bypass it (would become a tight loop)'
  );
  assert.strictEqual(
    shouldScheduleNextVoipTokenUploadAfterSettle({ ...allClear, hasOtherInFlightUpload: true }),
    false,
    'another attempt is already in flight -> must never start a second concurrent upload'
  );
}

// Simulates the exact rotation-pending-stall repro from Gate blocker 3:
//   1. Token A is uploading (attempt #1 holds the lock).
//   2. Register event for token B arrives; pending becomes B; attempt for B
//      dedupes onto attempt #1's still-in-flight Promise (modeled by simply
//      not creating a second attempt).
//   3. Attempt #1 (token A) succeeds. resolvePendingAfterUploadOutcome
//      correctly leaves B pending (A's attempt wasn't uploading B).
//   4. Attempt #1's `finally` releases its own lock, then must decide to
//      reschedule for B — proving B is not stranded.
function testRotationPendingIsScheduledAfterPriorAttemptSettles() {
  const authUserId = 'user-A';
  const eventA = { token: HEX_TOKEN_A, authUserId, environment: 'SANDBOX' };
  const eventB = { token: HEX_TOKEN_B, authUserId, environment: 'SANDBOX' };

  let pending = eventA;
  let inFlight = { requestId: 1, generation: 1, authUserId }; // attempt #1 (token A)

  // Step 2: B arrives while A is in flight.
  pending = eventB;
  // (attempt for B dedupes onto attempt #1 — no second lock taken)

  // Step 3: A succeeds.
  pending = resolvePendingAfterUploadOutcome(pending, eventA, true);
  assert.deepStrictEqual(pending, eventB, "B must survive A's success — A wasn't uploading B");

  // Step 4: attempt #1's finally releases its own lock...
  const wasMine = voipTokenMarkerMatches(inFlight, { requestId: 1, generation: 1, authUserId });
  assert.strictEqual(wasMine, true);
  if (wasMine) inFlight = null;

  // ...then decides whether to reschedule for the still-pending B.
  const decision = shouldScheduleNextVoipTokenUploadAfterSettle({
    hasPendingToken: !!pending,
    hasAccessToken: true,
    pendingOwnerMatchesCurrentAuthUserId: pending.authUserId === authUserId,
    hasScheduledRetryTimer: false,
    hasOtherInFlightUpload: inFlight !== null,
  });
  assert.strictEqual(decision, true, 'B must be scheduled for upload — it must not be stranded pending forever');
}

// A fails and has ALREADY scheduled its own backoff retry timer by the time
// `finally` runs — `finally` must not bypass that backoff with an immediate
// reschedule (which would turn it into a tight loop).
function testFailedAttemptWithExistingBackoffTimerDoesNotRescheduleImmediately() {
  const authUserId = 'user-A';
  const eventA = { token: HEX_TOKEN_A, authUserId, environment: 'SANDBOX' };

  // A fails; pending is retained (unchanged) by resolvePendingAfterUploadOutcome.
  const pending = resolvePendingAfterUploadOutcome(eventA, eventA, false);
  assert.deepStrictEqual(pending, eventA);

  // The failure branch already scheduled a backoff retry timer before
  // `finally` runs.
  const hasScheduledRetryTimer = true;

  const decision = shouldScheduleNextVoipTokenUploadAfterSettle({
    hasPendingToken: !!pending,
    hasAccessToken: true,
    pendingOwnerMatchesCurrentAuthUserId: pending.authUserId === authUserId,
    hasScheduledRetryTimer,
    hasOtherInFlightUpload: false,
  });
  assert.strictEqual(decision, false, 'must defer to the already-scheduled backoff, not bypass it immediately');
}

// --- Static check that no console.warn call site in the coordinator ever
// interpolates a raw value (the token, an error's message, etc.) — every
// warning must be fixed categorical text only.
function testNoRawTokenOrErrorMessageInLogStatements() {
  const coordinatorPath = path.join(__dirname, '..', 'components', 'ios-voip-callkit-coordinator.tsx');
  const source = fs.readFileSync(coordinatorPath, 'utf8');

  const interpolatedWarnCalls = source.match(/console\.warn\([^;]*?\$\{[^}]*\}/g) || [];
  assert.deepStrictEqual(
    interpolatedWarnCalls,
    [],
    'console.warn must never use template-literal interpolation (could embed the token or a URL containing it)'
  );

  const errorMessageWarnCalls = source.match(/console\.warn\([^;]*?error\.message/g) || [];
  assert.deepStrictEqual(
    errorMessageWarnCalls,
    [],
    'console.warn must never log error.message (a third-party/network error could embed the token or DELETE URL)'
  );
}

function run() {
  testIsValidVoipToken();
  testMapApnsEnvironment();
  testResolveApnsEnvironment();
  testVoipRegisterEventsEqual();
  testColdStartTokenBindsToRealUserNotNull();
  testLogoutThenNewUserRebindsSameLatestToken();
  testLogoutDoesNotUpload();
  testTokenRefreshSameUserSameTokenDoesNotReupload();
  testFailClosedEnvironmentSkipsEvenWhenIdentityReady();
  testShouldDeleteOldVoipToken();
  testResolvePendingAfterUploadOutcome();
  testVoipTokenMarkerMatches();
  testStaleFinallyDoesNotClearNewerLock();
  testShouldScheduleNextVoipTokenUploadAfterSettle();
  testRotationPendingIsScheduledAfterPriorAttemptSettles();
  testFailedAttemptWithExistingBackoffTimerDoesNotRescheduleImmediately();
  testNoRawTokenOrErrorMessageInLogStatements();
  console.log('voipTokenRegistration.test.js: all assertions passed');
}

run();
