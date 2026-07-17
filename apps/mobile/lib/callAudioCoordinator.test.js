// Plain Node script (no test framework) verifying callAudioCoordinator.ts's
// pure functions. Run from apps/mobile (same reproducible command already
// established for lib/nativeCallIntentQueue.test.js/lib/voipTokenRegistration.test.js):
//
//   cd apps/mobile
//   $env:TS_NODE_TRANSPILE_ONLY='true'
//   $env:TS_NODE_SKIP_PROJECT='true'
//   $env:TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
//   node -r ts-node/register lib/callAudioCoordinator.test.js
//
// (bash/zsh equivalent: TS_NODE_TRANSPILE_ONLY=true TS_NODE_SKIP_PROJECT=true
// TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"Node"}'
// node -r ts-node/register lib/callAudioCoordinator.test.js)
//
// callAudioCoordinator.ts has no React/React Native import, so (unlike
// components/voice-call-modal.tsx or contexts/call.tsx, which cannot be
// required outside a Metro runtime) it can be required directly here.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  INITIAL_CALLKIT_AUDIO_STATE,
  resolveCallKitManagedCallStart,
  resolveCallKitManagedCallEnd,
  resolveCallKitAudioActivation,
  resolveCallKitAudioDeactivation,
  isPrivateCallAudioAuthorized,
  shouldSyncAnswerIncomingCall,
} = require('./callAudioCoordinator.ts');

const CALL_A = '11111111-1111-4111-8111-111111111111';
const CALL_B = '22222222-2222-4222-8222-222222222222';

// 1. A plain foreground call (never displayed via CallKit) must never wait on
// a CallKit audio event it may never receive.
function testPlainForegroundCallDoesNotWaitForCallKitActivate() {
  assert.strictEqual(
    isPrivateCallAudioAuthorized({
      isCallKitManaged: false,
      callKitAudio: INITIAL_CALLKIT_AUDIO_STATE,
      callId: CALL_A,
    }),
    true
  );
  // Still true even if some OTHER call happens to be CallKit-tracked/active —
  // a plain call must be completely unaffected by CallKit audio state.
  const otherCallActive = resolveCallKitAudioActivation(resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_B));
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: false, callKitAudio: otherCallActive, callId: CALL_A }),
    true
  );
}

// 2. A CallKit-managed call must not be authorized (must not let
// ConnectedCallScreen seize audio) before CallKit's own activate fires.
function testCallKitManagedCallNotAuthorizedBeforeActivate() {
  const tracking = resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_A);
  assert.strictEqual(tracking.audioActive, false);
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: tracking, callId: CALL_A }),
    false
  );

  const activated = resolveCallKitAudioActivation(tracking);
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: activated, callId: CALL_A }),
    true,
    'authorized once (and only once) CallKit has actually activated'
  );
}

// 3. Repeated activate is idempotent — only the first one has any effect.
function testRepeatedActivateIsIdempotent() {
  const tracking = resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_A);
  const activatedOnce = resolveCallKitAudioActivation(tracking);
  assert.strictEqual(activatedOnce.audioActive, true);

  const activatedTwice = resolveCallKitAudioActivation(activatedOnce);
  assert.strictEqual(activatedTwice.audioActive, true);
  assert.strictEqual(activatedTwice, activatedOnce, 'a second activate is a true no-op (same state), not a fresh toggle');
}

// 4. Repeated deactivate is idempotent — only the first one has any effect.
function testRepeatedDeactivateIsIdempotent() {
  const tracking = resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_A);
  const activated = resolveCallKitAudioActivation(tracking);
  const deactivatedOnce = resolveCallKitAudioDeactivation(activated);
  assert.strictEqual(deactivatedOnce.audioActive, false);

  const deactivatedTwice = resolveCallKitAudioDeactivation(deactivatedOnce);
  assert.strictEqual(deactivatedTwice, deactivatedOnce, 'a second deactivate is a true no-op, not a fresh toggle');
}

// 5. An old call's late deactivate must not affect a new call — once the old
// call ends and a new one starts being tracked, audioActive always resets to
// false, so a stray deactivate arriving after that transition is a no-op
// (never incorrectly stops a call that hasn't even been authorized yet).
function testOldCallLateDeactivateDoesNotAffectNewCall() {
  const aTracking = resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_A);
  const aActivated = resolveCallKitAudioActivation(aTracking);
  assert.strictEqual(aActivated.audioActive, true);

  // Call A ends (terminal outcome / resetToIdle) — tracking clears.
  const ended = resolveCallKitManagedCallEnd(aActivated);
  assert.strictEqual(ended.managedCallId, null);

  // Call B starts being tracked, fresh — audioActive is reset, never
  // inherited from A.
  const bTracking = resolveCallKitManagedCallStart(ended, CALL_B);
  assert.strictEqual(bTracking.audioActive, false);
  assert.notStrictEqual(bTracking.generation, aTracking.generation);

  // A's own deactivate, arriving late (after B has already started tracking)
  // — a no-op against B's already-false audioActive; B remains unauthorized
  // until ITS OWN activate arrives, never spuriously toggled by A's stale
  // event.
  const staleDeactivateApplied = resolveCallKitAudioDeactivation(bTracking);
  assert.strictEqual(staleDeactivateApplied, bTracking);
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: staleDeactivateApplied, callId: CALL_B }),
    false
  );
}

// 6. terminal/reset/logout, then a late activate arriving afterward, must be
// discarded — nothing tracked means nothing to authorize.
function testLateActivateAfterResetIsDiscarded() {
  const tracking = resolveCallKitManagedCallStart(INITIAL_CALLKIT_AUDIO_STATE, CALL_A);
  const activated = resolveCallKitAudioActivation(tracking);
  const reset = resolveCallKitManagedCallEnd(activated); // logout/terminal/unmount
  assert.strictEqual(reset.managedCallId, null);
  assert.strictEqual(reset.audioActive, false);

  const lateActivateApplied = resolveCallKitAudioActivation(reset);
  assert.strictEqual(lateActivateApplied, reset, 'a stray activate with nothing tracked is a true no-op');
  assert.strictEqual(lateActivateApplied.audioActive, false);
}

// 7. A -> B -> A: generation strictly increases across every transition, and
// each new tracking instance (including the SECOND "A") starts unauthorized
// until its own fresh activate — a stale authorization from the FIRST "A"
// instance can never leak into the second.
function testABAGenerationProtection() {
  let state = INITIAL_CALLKIT_AUDIO_STATE;

  state = resolveCallKitManagedCallStart(state, CALL_A); // A (first time)
  const genA1 = state.generation;
  state = resolveCallKitAudioActivation(state);
  assert.strictEqual(isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: state, callId: CALL_A }), true);

  state = resolveCallKitManagedCallEnd(state); // A ends
  const genEnd1 = state.generation;
  assert.ok(genEnd1 > genA1);

  state = resolveCallKitManagedCallStart(state, CALL_B); // B
  const genB = state.generation;
  assert.ok(genB > genEnd1);
  assert.strictEqual(isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: state, callId: CALL_B }), false);
  state = resolveCallKitAudioActivation(state);

  state = resolveCallKitManagedCallEnd(state); // B ends
  const genEnd2 = state.generation;
  assert.ok(genEnd2 > genB);

  state = resolveCallKitManagedCallStart(state, CALL_A); // A (second time — the "A" in A->B->A)
  const genA2 = state.generation;
  assert.ok(genA2 > genEnd2);
  assert.notStrictEqual(genA2, genA1, 'the second A instance must never reuse the first A instance\'s generation');
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: state, callId: CALL_A }),
    false,
    'the second A instance must NOT be authorized just because the first A instance once was'
  );
}

// 8. A CallKit-displayed call, once the App UI Accept succeeds
// (server-confirmed ACCEPTED), triggers answerIncomingCall exactly once.
function testAnswerIncomingCallSyncedOnceForCallKitManagedCall() {
  const decision1 = shouldSyncAnswerIncomingCall({
    alreadySyncedCallId: null,
    targetCallId: CALL_A,
    isIdentityStillValid: true,
    isCallKitManaged: true,
    callStatus: 'ACCEPTED',
  });
  assert.strictEqual(decision1, true);

  // Now that CALL_A has been synced, a second evaluation (e.g. a duplicate
  // settle/re-render) must not sync again.
  const decision2 = shouldSyncAnswerIncomingCall({
    alreadySyncedCallId: CALL_A,
    targetCallId: CALL_A,
    isIdentityStillValid: true,
    isCallKitManaged: true,
    callStatus: 'ACCEPTED',
  });
  assert.strictEqual(decision2, false);
}

// 9. CallKit-originated Answer must not echo back into answerIncomingCall —
// this is a code-shape guarantee (contexts/call.tsx's handleNativeAnswer
// calls acceptCallAction directly, never the acceptCall wrapper that runs
// shouldSyncAnswerIncomingCall/answerIncomingCallKitCall), not something this
// pure function's inputs alone can express — verified here the same way
// voipTokenRegistration.test.js's testNoRawTokenOrErrorMessageInLogStatements
// verifies a structural property via a source scan.
function testCallKitOriginatedAnswerDoesNotEcho() {
  const callTsxPath = path.join(__dirname, '..', 'contexts', 'call.tsx');
  const source = fs.readFileSync(callTsxPath, 'utf8');

  const handleNativeAnswerStart = source.indexOf('const handleNativeAnswer = useCallback(');
  assert.ok(handleNativeAnswerStart >= 0, 'handleNativeAnswer must exist');
  const handleNativeEndStart = source.indexOf('const handleNativeEnd = useCallback(', handleNativeAnswerStart);
  assert.ok(handleNativeEndStart > handleNativeAnswerStart, 'handleNativeEnd must follow handleNativeAnswer');
  const handleNativeAnswerBody = source.slice(handleNativeAnswerStart, handleNativeEndStart);

  assert.ok(
    !handleNativeAnswerBody.includes('answerIncomingCallKitCall'),
    'handleNativeAnswer (the CallKit-originated path) must never call answerIncomingCallKitCall — that would echo a CallKit-originated answer back into CallKit'
  );
  assert.ok(
    !handleNativeAnswerBody.includes('shouldSyncAnswerIncomingCall'),
    'handleNativeAnswer must never run the App-Accept sync decision at all — only the plain UI acceptCall wrapper does'
  );
  assert.ok(
    handleNativeAnswerBody.includes('acceptCallAction()'),
    'handleNativeAnswer must still call the shared acceptCallAction directly (unwrapped)'
  );
}

// 10. A plain incoming call CallKit never displayed must never trigger
// answerIncomingCall, regardless of accept success.
function testPlainIncomingCallNeverTriggersAnswerIncomingCall() {
  const decision = shouldSyncAnswerIncomingCall({
    alreadySyncedCallId: null,
    targetCallId: CALL_A,
    isIdentityStillValid: true,
    isCallKitManaged: false,
    callStatus: 'ACCEPTED',
  });
  assert.strictEqual(decision, false);
}

// 11. answerIncomingCall throwing/rejecting must never change the server's
// already-confirmed ACCEPTED status — a code-shape guarantee (the sync call
// is fire-and-forget, issued strictly AFTER activeCall/phase are already
// committed from the successful acceptCallAction, and lib/voipPushKit.ts's
// answerIncomingCallKitCall itself swallows every error internally and never
// rejects), verified here via the same source-scan technique as test 9.
function testAnswerIncomingCallFailureCannotUndoAcceptedState() {
  const callTsxPath = path.join(__dirname, '..', 'contexts', 'call.tsx');
  const source = fs.readFileSync(callTsxPath, 'utf8');

  const acceptCallStart = source.indexOf('const acceptCall = useCallback(async () => {');
  assert.ok(acceptCallStart >= 0, 'the acceptCall wrapper must exist');
  const nextConstStart = source.indexOf('\n  const ', acceptCallStart + 1);
  const acceptCallBody = source.slice(acceptCallStart, nextConstStart > 0 ? nextConstStart : undefined);

  assert.ok(
    acceptCallBody.includes('void answerIncomingCallKitCall(callId)'),
    'the sync call must be fire-and-forget (void), never awaited into a state-changing branch'
  );
  assert.ok(
    !/await\s+answerIncomingCallKitCall/.test(acceptCallBody),
    'answerIncomingCallKitCall must never be awaited — its outcome must never gate setPhase/setActiveCall/reportMediaFailure'
  );

  const voipPushKitPath = path.join(__dirname, 'voipPushKit.ts');
  const voipPushKitSource = fs.readFileSync(voipPushKitPath, 'utf8');
  const answerFnStart = voipPushKitSource.indexOf('export async function answerIncomingCallKitCall');
  assert.ok(answerFnStart >= 0);
  const answerFnBody = voipPushKitSource.slice(answerFnStart, voipPushKitSource.indexOf('\n}', answerFnStart) + 2);
  assert.ok(answerFnBody.includes('try {'), 'answerIncomingCallKitCall must swallow the native call in a try/catch, never letting it reject the caller');
}

// --- Fix 1: activate arriving before the REST GET completes -----------------

// The coordinator now seeds tracking (resolveCallKitManagedCallStart) the
// instant it sees a legal callId — BEFORE handleNativeIncoming/
// handleNativeAnswer's own REST GET even starts. Models that exact ordering:
// seed -> activate (arrives mid-GET) -> the REST-completion path's own
// redundant re-seed (markCallKitManaged) for the SAME callId once the GET
// finally resolves. The activate must survive that redundant re-seed.
function testActivateArrivingBeforeRestCompletionIsPreserved() {
  let state = INITIAL_CALLKIT_AUDIO_STATE;
  state = resolveCallKitManagedCallStart(state, CALL_A); // coordinator's enqueue-time seed
  state = resolveCallKitAudioActivation(state); // didActivateAudioSession arrives while the GET is still in flight
  assert.strictEqual(state.audioActive, true);

  // handleNativeIncoming/handleNativeAnswer's own markCallKitManaged call,
  // once the GET finally resolves — resolveCallKitManagedCallStart is a
  // no-op for the SAME callId, so it must not reset audioActive back to
  // false.
  const afterRestCompletes = resolveCallKitManagedCallStart(state, CALL_A);
  assert.strictEqual(afterRestCompletes, state, 'a redundant same-callId re-seed must be a true no-op');
  assert.strictEqual(afterRestCompletes.audioActive, true);
  assert.strictEqual(
    isPrivateCallAudioAuthorized({ isCallKitManaged: true, callKitAudio: afterRestCompletes, callId: CALL_A }),
    true
  );
}

// --- Fix 2: watchdog / partner-timer gating on audioAuthorized ---------------
// components/voice-call-modal.tsx cannot be required outside a Metro runtime
// (it imports @livekit/react-native/react-native) — verified here via source
// scan, the same technique voipTokenRegistration.test.js's
// testNoRawTokenOrErrorMessageInLogStatements and this file's own
// testCallKitOriginatedAnswerDoesNotEcho already use for a property a pure
// function's inputs/outputs alone can't express.

function readVoiceCallModalSource() {
  return fs.readFileSync(path.join(__dirname, '..', 'components', 'voice-call-modal.tsx'), 'utf8');
}

function testWatchdogNotStartedWhenNotAuthorized() {
  const source = readVoiceCallModalSource();
  const effectStart = source.indexOf('useEffect(() => {\n    // Not authorized yet');
  assert.ok(effectStart >= 0, 'the connection watchdog effect must exist with its not-authorized guard');
  const effectEnd = source.indexOf('}, [audioAuthorized, onConfirmOrFail]);', effectStart);
  assert.ok(effectEnd > effectStart, 'the watchdog effect must depend on audioAuthorized (so it re-evaluates on every transition)');
  const effectBody = source.slice(effectStart, effectEnd);
  assert.ok(
    /if \(!audioAuthorized\) return;/.test(effectBody),
    'the watchdog effect must bail out (never schedule setTimeout) while not authorized'
  );
}

function testWatchdogStartsOnAuthorizedTrueAndClearsOnFalse() {
  const source = readVoiceCallModalSource();
  const effectStart = source.indexOf('useEffect(() => {\n    // Not authorized yet');
  const effectEnd = source.indexOf('}, [audioAuthorized, onConfirmOrFail]);', effectStart);
  const effectBody = source.slice(effectStart, effectEnd);

  assert.ok(effectBody.includes('timeoutRef.current = setTimeout('), 'must start a timer once past the guard (i.e. once authorized)');
  assert.ok(
    /return \(\) => \{\s*if \(timeoutRef\.current\)/.test(effectBody),
    'the effect cleanup must clear a pending timer — this cleanup re-runs (clearing the timer) whenever audioAuthorized flips back to false, since that dependency change unmounts/remounts the effect'
  );
  assert.ok(
    /if \(!hasConnectedRef\.current && audioAuthorizedRef\.current\) onConfirmOrFail\(\);/.test(effectBody),
    'the timer callback must re-check BOTH hasConnected and the latest audioAuthorized before firing, in case authorization was revoked after the timer was scheduled'
  );
}

function testPartnerTimersGatedOnAudioAuthorized() {
  const source = readVoiceCallModalSource();
  assert.ok(
    source.includes('if (!audioAuthorized) {') && source.includes('prevHasPartner.current = hasPartner;\n      return;'),
    'the partner join/leave effect must bail out (never schedule/show a "left the call" banner+timer) while a gate-caused disconnect is in effect'
  );
  const neverJoinedEffectMatch = source.match(/if \(!audioAuthorized\) return;\s*\n\s*if \(connectionState !== 'connected'\) return;/);
  assert.ok(neverJoinedEffectMatch, 'the "partner never joined" effect must also bail out while not authorized, not just rely on connectionState');
}

// --- Fix 3: App Accept -> CallKit sync uses an explicit GET, not activeCallRef -----

function testShouldSyncAnswerIncomingCallRequiresAcceptedStatus() {
  const base = {
    alreadySyncedCallId: null,
    targetCallId: CALL_A,
    isIdentityStillValid: true,
    isCallKitManaged: true,
  };
  assert.strictEqual(shouldSyncAnswerIncomingCall({ ...base, callStatus: 'RINGING' }), false);
  assert.strictEqual(shouldSyncAnswerIncomingCall({ ...base, callStatus: 'ENDED' }), false);
  assert.strictEqual(shouldSyncAnswerIncomingCall({ ...base, callStatus: 'CANCELED' }), false);
  assert.strictEqual(shouldSyncAnswerIncomingCall({ ...base, callStatus: 'ACCEPTED' }), true);
}

function testAcceptCallUsesExplicitGetNotActiveCallRef() {
  const callTsxPath = path.join(__dirname, '..', 'contexts', 'call.tsx');
  const source = fs.readFileSync(callTsxPath, 'utf8');

  const acceptCallStart = source.indexOf('const acceptCall = useCallback(async () => {');
  const acceptCallEnd = source.indexOf('}, [acceptCallAction]);', acceptCallStart);
  assert.ok(acceptCallEnd > acceptCallStart, 'the acceptCall wrapper must exist');
  const body = source.slice(acceptCallStart, acceptCallEnd);

  assert.ok(
    body.includes('call = await getCallApi(token, callId);'),
    'must confirm the post-accept status via an explicit GET, not by reading activeCallRef.current (which may not have re-synced from this exact acceptCallAction call yet)'
  );
  assert.ok(
    /catch \{\s*\n\s*return; \/\/ GET failed/.test(body),
    'a failed confirmation GET must return without syncing (never call answerIncomingCallKitCall on an unconfirmed status)'
  );
  assert.ok(
    body.includes('identityStillValid()'),
    'must re-check identity (generation + authUserId) after every await, not just callId'
  );
  assert.ok(
    !/activeCallRef\.current\.call\.status/.test(body) && !/latest\.call\.status/.test(body),
    'must never derive the ACCEPTED confirmation from activeCallRef.current directly — only from the explicit GET result'
  );
}

function run() {
  testPlainForegroundCallDoesNotWaitForCallKitActivate();
  testCallKitManagedCallNotAuthorizedBeforeActivate();
  testRepeatedActivateIsIdempotent();
  testRepeatedDeactivateIsIdempotent();
  testOldCallLateDeactivateDoesNotAffectNewCall();
  testLateActivateAfterResetIsDiscarded();
  testABAGenerationProtection();
  testAnswerIncomingCallSyncedOnceForCallKitManagedCall();
  testCallKitOriginatedAnswerDoesNotEcho();
  testPlainIncomingCallNeverTriggersAnswerIncomingCall();
  testAnswerIncomingCallFailureCannotUndoAcceptedState();
  testActivateArrivingBeforeRestCompletionIsPreserved();
  testWatchdogNotStartedWhenNotAuthorized();
  testWatchdogStartsOnAuthorizedTrueAndClearsOnFalse();
  testPartnerTimersGatedOnAudioAuthorized();
  testShouldSyncAnswerIncomingCallRequiresAcceptedStatus();
  testAcceptCallUsesExplicitGetNotActiveCallRef();
  console.log('callAudioCoordinator.test.js: all assertions passed');
}

run();
