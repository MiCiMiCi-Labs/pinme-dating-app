// Pure, framework-free helpers for the private-call CallKit audio-session
// ownership fix and the App-Accept -> CallKit answerIncomingCall sync (see
// contexts/call.tsx and components/voice-call-modal.tsx). Deliberately has no
// React/React Native import so it can be unit-tested with plain `node:assert`
// (see callAudioCoordinator.test.js) without a mobile test framework.
//
// ---------------------------------------------------------------------------
// Background: three potential owners of the iOS AVAudioSession
// ---------------------------------------------------------------------------
// 1. @livekit/react-native's `registerGlobals()` (called once, module scope,
//    in voice-call-modal.tsx) installs an automatic engine-tied audio-session
//    manager by default (`autoConfigureAudioSession: true` — see the real
//    installed source at node_modules/@livekit/react-native/src/audio/
//    AudioManager.ts's `setupIOSAudioManagement`): it listens for the native
//    WebRTC audio engine's own willEnableEngine/didDisableEngine events (i.e.
//    "the local mic or a remote track is actually about to play/record") and
//    calls `AudioSession.startAudioSession()`/`stopAudioSession()` itself,
//    tied to real media engagement, not to any UI mount/unmount. This is left
//    ON globally (unchanged) — turning it off would also affect the
//    voice-rooms feature, which relies on the same default.
// 2. `ConnectedCallScreen` (components/voice-call-modal.tsx) used to ALSO
//    call `AudioSession.startAudioSession()`/`stopAudioSession()` directly in
//    its own mount/unmount effect — a second, redundant owner, now removed;
//    see that file's history.
// 3. CallKit's `didActivateAudioSession`/`didDeactivateAudioSession`
//    (react-native-callkeep, confirmed against the installed native source at
//    node_modules/react-native-callkeep/ios/RNCallKeep/RNCallKeep.m lines
//    ~1133-1155) fire only for a call CallKit is actually displaying/
//    managing. Critically, `didActivateAudioSession` posts a *synthetic*
//    `AVAudioSessionInterruptionNotification` (type Ended, option
//    ShouldResume) before calling its own `configureAudioSession` — this is
//    precisely what cues WebRTC's own native audio session (which observes
//    that same notification) to resume publishing/playing audio. In other
//    words, for a CallKit-managed call, CallKit itself is the actual
//    authority the OS audio session answers to; letting owner #1 race ahead
//    of it (by connecting/publishing before CallKit hands over control) is
//    the real bug, not merely "too many start() calls".
//
// The fix (see contexts/call.tsx/voice-call-modal.tsx) does NOT try to make
// owner #3 call AudioSession.start/stop directly (that would just be a FOURTH
// competing caller). Instead, it gates *when owner #1 is allowed to engage at
// all*: `<LiveKitRoom connect={...}>` only becomes `true` once this module's
// `isPrivateCallAudioAuthorized` says so — immediately for a call that was
// never CallKit-displayed (foreground Phase 2 behavior, verbatim), or only
// once CallKit's own didActivateAudioSession has fired for a CallKit-managed
// one. `connect` going false->true reliably re-invokes `room.connect()` (and
// true->false reliably calls `room.disconnect()`) per the installed
// @livekit/components-react source (node_modules/@livekit/components-react/
// dist/room-Q0GUQkyk.mjs's useLiveKitRoom effect deps include `connect`) —
// unlike toggling the `audio` prop after the room's `SignalConnected` event
// has already fired once, which that same source shows does NOT retroactively
// publish/unpublish the mic (the publish-mic handler only runs from the
// `SignalConnected` listener, which fires once per connection).

// ---------------------------------------------------------------------------
// CallKit-managed call tracking + audio-session activation state
// ---------------------------------------------------------------------------

export type CallKitAudioState = {
  // The callId CallKit is currently known to be displaying/managing, or null
  // if none (never displayed one yet, or the previously-tracked one ended).
  managedCallId: string | null;
  // Bumped every time managedCallId is set OR cleared — not itself compared
  // against anything (didActivate/didDeactivate carry no callId or
  // generation of their own to check against), but its monotonic increase is
  // what guarantees audioActive is always freshly reset to false whenever
  // tracking moves on to a different call, rather than silently inheriting a
  // previous call's authorization.
  generation: number;
  // Whether CallKit has told us its audio session is currently active for
  // the current managedCallId/generation.
  audioActive: boolean;
};

export const INITIAL_CALLKIT_AUDIO_STATE: CallKitAudioState = {
  managedCallId: null,
  generation: 0,
  audioActive: false,
};

// Called once a native CallKit intent handler (handleNativeIncoming/
// handleNativeAnswer in contexts/call.tsx) confirms `callId` as a call CallKit
// displayed/is managing. A different callId than the one already tracked
// means CallKit moved on to a new call — should be unreachable given this
// app's CallKit setup (`maximumCallGroups: '1'`, `maximumCallsPerCallGroup:
// '1'`, see lib/voipPushKit.ts's CALLKEEP_SETUP_OPTIONS), which structurally
// prevents two CallKit calls from ever being tracked concurrently, but never
// trusted blindly: audioActive is unconditionally reset to false for the new
// callId, so a stale authorization can never leak from one call to the next.
export function resolveCallKitManagedCallStart(
  state: CallKitAudioState,
  callId: string
): CallKitAudioState {
  if (state.managedCallId === callId) return state; // already tracking this exact call — no-op
  return { managedCallId: callId, generation: state.generation + 1, audioActive: false };
}

// Called once the tracked call is known to be over (terminal outcome,
// identity invalidate/logout, or the coordinator/provider unmounting) —
// clears tracking so a subsequently-arriving stray activate/deactivate event
// (no callId of its own — see resolveCallKitAudioActivation/Deactivation
// below) is a no-op instead of authorizing/deauthorizing audio for a call
// that no longer exists.
export function resolveCallKitManagedCallEnd(state: CallKitAudioState): CallKitAudioState {
  if (state.managedCallId === null) return state;
  return { managedCallId: null, generation: state.generation + 1, audioActive: false };
}

// didActivateAudioSession carries no callId (confirmed against the installed
// react-native-callkeep type declarations — EventsPayload['didActivateAudioSession']
// is `undefined`). The only correlation available at all is "is there
// currently a CallKit-managed call being tracked" — a stray activate with
// nothing tracked (already ended/logged out/unmounted) is dropped rather than
// resurrecting stale authorization for a call that's gone. Idempotent: a
// second activate while already active is a no-op (never toggles anything,
// so the caller never re-runs a "just became authorized" side effect twice).
export function resolveCallKitAudioActivation(state: CallKitAudioState): CallKitAudioState {
  if (state.managedCallId === null) return state;
  if (state.audioActive) return state;
  return { ...state, audioActive: true };
}

// Symmetric to resolveCallKitAudioActivation. Note on the inherent limit of a
// callId-less payload: this can only tell "is ANY call currently tracked",
// not "is this deactivate for the SAME call whose activate we saw" — a truly
// misordered deactivate for an already-ended call arriving after a NEW call
// has started being tracked is guarded by the generation reset in
// resolveCallKitManagedCallStart/End (the new call always starts with
// audioActive=false, so a stale deactivate lands on an already-false value —
// a no-op, never incorrectly stopping a call that was never actually
// authorized yet). A stale deactivate arriving AFTER the new call's OWN
// activate already flipped audioActive=true cannot be distinguished from a
// genuine one with this payload alone; this relies on CallKit's own
// single-call-at-a-time invariant (see resolveCallKitManagedCallStart's
// comment) to make that ordering structurally not occur — not verified on a
// real device (see the final report).
export function resolveCallKitAudioDeactivation(state: CallKitAudioState): CallKitAudioState {
  if (state.managedCallId === null) return state;
  if (!state.audioActive) return state;
  return { ...state, audioActive: false };
}

// The single decision components/voice-call-modal.tsx's `<LiveKitRoom
// connect={...}>` gate carries out: a call never displayed via CallKit
// (plain Phase-2 foreground caller/callee) is always authorized immediately
// — this device may never even receive a CallKit audio event for it, so
// gating on `callKitAudio` at all would mean it never connects. A
// CallKit-managed call is authorized only while `callKitAudio` is currently
// tracking THIS exact callId AND has seen an activate for it.
export function isPrivateCallAudioAuthorized(input: {
  isCallKitManaged: boolean;
  callKitAudio: CallKitAudioState;
  callId: string;
}): boolean {
  if (!input.isCallKitManaged) return true;
  return input.callKitAudio.managedCallId === input.callId && input.callKitAudio.audioActive;
}

// ---------------------------------------------------------------------------
// App-Accept -> CallKit answerIncomingCall sync (Gate requirement, section
// three) — pure so the "only once per callId, never for a call CallKit never
// displayed, never for a call already superseded by an identity switch" rules
// are unit-testable without a React harness. Deliberately has NO input for
// "did this accept originate from CallKit's own native answer event" — the
// echo-suppression instead comes from CODE SHAPE: contexts/call.tsx only
// calls this decision (and, if true, lib/voipPushKit.ts's
// answerIncomingCallKitCall) from the plain UI `acceptCall` entry point,
// never from handleNativeAnswer (which calls the shared acceptCallAction
// directly) — see callAudioCoordinator.test.js's source-scan test for a
// static check of that invariant, mirroring
// voipTokenRegistration.test.js's testNoRawTokenOrErrorMessageInLogStatements
// pattern for a property this module's inputs/outputs alone can't express.
// ---------------------------------------------------------------------------

export function shouldSyncAnswerIncomingCall(input: {
  // The callId this exact sync already ran for, if any — a per-active-call
  // ref (contexts/call.tsx's answerIncomingCallSyncedForRef), reset on
  // resetToIdle. Only one call can be active at a time, so a single "last
  // synced callId" (not a growing set) is sufficient and never leaks memory
  // across a long-running app session.
  alreadySyncedCallId: string | null;
  targetCallId: string;
  // recoveryGenerationRef.current === (the generation captured before the
  // accept attempt started) — false means an identity switch happened while
  // the accept was in flight; a superseded attempt must never sync CallKit
  // for whatever the session has since moved on to.
  isIdentityStillValid: boolean;
  // Whether CallKit ever displayed this exact callId (ActiveCall.isCallKitManaged).
  isCallKitManaged: boolean;
  // The CURRENT (post-accept) server-confirmed status of this exact call.
  callStatus: string;
}): boolean {
  if (input.alreadySyncedCallId === input.targetCallId) return false;
  if (!input.isIdentityStillValid) return false;
  if (!input.isCallKitManaged) return false;
  return input.callStatus === 'ACCEPTED';
}
