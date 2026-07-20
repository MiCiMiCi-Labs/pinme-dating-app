import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import {
  acceptCall as acceptCallApi,
  cancelCall as cancelCallApi,
  declineCall as declineCallApi,
  endCall as endCallApi,
  failCall as failCallApi,
  getActiveCall as getActiveCallApi,
  getCall as getCallApi,
  getCallLiveKitCredentials,
  getIncomingCalls,
  startCall as startCallApi,
  ApiError,
  type CallFailureReason,
  type CallSummary,
  type LiveKitCredentials,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { markChatNeedsRefresh } from '@/stores/chatEvents.store';
import { showToast } from '@/stores/toast.store';
import { useAccessToken, useAuthUserId } from '@/queries/auth';
import { useCurrentUser } from '@/queries/user.queries';
import { endNativeCallKitCall, answerIncomingCallKitCall } from '@/lib/voipPushKit';
import {
  isValidCallId,
  resolveAnswerConfirmation,
  resolveEndConfirmation,
  type NativeCallIntentResult,
} from '@/lib/nativeCallIntentQueue';
import {
  INITIAL_CALLKIT_AUDIO_STATE,
  isPrivateCallAudioAuthorized as resolveIsPrivateCallAudioAuthorized,
  resolveCallKitAudioActivation,
  resolveCallKitAudioDeactivation,
  resolveCallKitManagedCallEnd,
  resolveCallKitManagedCallStart,
  shouldSyncAnswerIncomingCall,
  type CallKitAudioState,
} from '@/lib/callAudioCoordinator';

// Global call state machine — see docs/private-voice-calling-spec.md
// "移动端架构 > 全局 CallProvider". This intentionally does not own CallKit
// or PushKit (phase 3): it only drives foreground signaling (Supabase
// Realtime + polling fallback) and the in-app ringing/connected UI.
export type CallPhase =
  | 'idle'
  | 'outgoingRinging'
  | 'incomingRinging'
  | 'accepting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ending'
  | 'ended'
  | 'failed';

export type ActiveCall = {
  call: CallSummary;
  livekit: LiveKitCredentials | null;
  role: 'caller' | 'callee';
  // Whether CallKit ever displayed this exact callId (via a native
  // didDisplayIncomingCall/answerCall intent — see handleNativeIncoming/
  // handleNativeAnswer below), as opposed to a plain Phase 2 foreground call
  // (started/recovered/refreshed without ever going through the coordinator's
  // native intent path). Gates both the private-call audio-session
  // authorization (see isPrivateCallAudioAuthorized below) and the
  // App-Accept -> CallKit answerIncomingCall sync — a call this device never
  // learned CallKit was displaying must never wait on a CallKit audio event
  // it may never receive, and must never trigger a CallKit sync call for a
  // call CallKit doesn't know about.
  isCallKitManaged: boolean;
};

// Identity of whichever decline/cancel/end/fail attempt currently holds the
// shared lifecycle-action lock (see lifecycleActionInFlightRef). `owner`
// distinguishes which of runLifecycleAction (decline/cancel/end) or
// attemptMediaFailureReport minted it; `requestId` (drawn from a single
// shared counter both sides use) and `generation` (tied to the app's
// identity/recovery generation) make it safe to tell "is this exact attempt
// still the authoritative one" apart from "does some other, possibly stale,
// attempt merely share the same callId" — the classic ABA case where the
// same Call is recovered again under a new identity generation.
type LifecycleActionOwner = 'lifecycle' | 'mediaFailure';
type LifecycleActionMarker = {
  callId: string;
  requestId: number;
  generation: number;
  owner: LifecycleActionOwner;
};

type CallContextType = {
  phase: CallPhase;
  activeCall: ActiveCall | null;
  startCall: (matchId: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  cancelCall: () => Promise<void>;
  endCall: () => Promise<void>;
  // The LiveKit room UI reports real media state back so CallProvider's
  // phase stays the single source of truth for "connected" (mirrors the
  // spec's CallKit/UI-sync requirement, minus CallKit itself in phase 2).
  reportMediaConnected: () => void;
  reportMediaDisconnected: () => void;
  // Reports a definitive local media/connection failure (denied mic
  // permission, a LiveKit connection that never established or is
  // conclusively gone) to the server via POST /:callId/fail.
  reportMediaFailure: (reason: CallFailureReason) => Promise<void>;
  // Re-fetches the Call from the server and only escalates to
  // reportMediaFailure('LIVEKIT_CONNECTION_FAILED') if the server still says
  // ACCEPTED — never overwrites a terminal outcome (e.g. the peer ending the
  // call normally) with FAILED. Used for LiveKitRoom's onDisconnected/onError
  // and for "the partner left and didn't come back" after a grace period.
  confirmCallOrFail: () => Promise<void>;
  // Native intent entry points for the iOS PushKit/CallKit JS runtime
  // coordinator (components/ios-voip-callkit-coordinator.tsx) — see
  // docs/private-voice-calling-spec.md "iOS 原生能力". REST (GET
  // /calls/:callId) is the only source of truth for what a native
  // event/payload *means*; these never trust callerName/handle/role/status
  // carried by a PushKit or CallKit payload. Deliberately NOT a second call
  // state machine: each of these re-validates against the server and then
  // delegates into the existing accept/decline/cancel/end actions and their
  // reconciliation paths above.
  handleNativeIncoming: (callId: string) => Promise<NativeCallIntentResult>;
  handleNativeAnswer: (callId: string) => Promise<NativeCallIntentResult>;
  handleNativeEnd: (callId: string) => Promise<NativeCallIntentResult>;
  // CallKit `didActivateAudioSession`/`didDeactivateAudioSession` forwarded
  // by the coordinator — no callId of their own (see
  // lib/callAudioCoordinator.ts), so these just poke the CallKit-audio state
  // machine, which is the only thing that carries call-scoped meaning.
  handleNativeAudioSessionActivated: () => void;
  handleNativeAudioSessionDeactivated: () => void;
  // Called by the coordinator the instant it sees a legal callId from a
  // native incoming/didDisplay/answer event — before handleNativeIncoming/
  // handleNativeAnswer's own REST GET has even started. Only starts audio
  // tracking; never creates activeCall/requests a token/calls accept.
  handleNativeCallKitCallIdSeen: (callId: string) => void;
  // Whether components/voice-call-modal.tsx's `<LiveKitRoom connect={...}>`
  // may actually connect (and therefore let LiveKit's own registerGlobals()
  // audio-session manager engage) right now — see
  // lib/callAudioCoordinator.ts's isPrivateCallAudioAuthorized for the full
  // rationale. Always true for a call CallKit never displayed.
  isPrivateCallAudioAuthorized: boolean;
};

const CallContext = createContext<CallContextType | null>(null);

// LiveKit's native module isn't available in Expo Go — same guard the old
// per-screen call button used before this became a global provider.
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

const TERMINAL_STATUSES = new Set<CallSummary['status']>([
  'DECLINED',
  'CANCELED',
  'MISSED',
  'ENDED',
  'FAILED',
]);

const IDLE_POLL_MS = 3000;
const RINGING_POLL_MS = 1000;
const ACCEPTED_POLL_MS = 2000;
const TERMINAL_DISPLAY_MS = 1500;
// Retry interval for a pending media-failure report or pending confirmation
// once its own request AND its follow-up GET reconciliation have both
// failed. Fixed (not exponential) and gated by an in-flight flag so a
// prolonged outage produces one attempt every interval, never a storm.
const MEDIA_FAILURE_RETRY_MS = 5000;
const CONFIRM_RETRY_MS = 5000;
// How long a native-end suppression marker (see nativeEndSuppressionRef)
// stays valid — long enough to cover a decline/cancel/end REST round trip
// plus its own reconciliation retry, short enough that it can never mask
// an unrelated later terminal sync for the same (never-reused) callId.
const NATIVE_END_SUPPRESSION_MS = 15_000;

function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function terminalToastFor(call: CallSummary): { message: string; type: 'info' | 'error' } | null {
  switch (call.status) {
    case 'DECLINED':
      return { message: 'Call declined', type: 'info' };
    case 'CANCELED':
      return { message: 'Call canceled', type: 'info' };
    case 'MISSED':
      return { message: 'No answer', type: 'info' };
    case 'FAILED':
      switch (call.failureReason) {
        case 'MICROPHONE_DENIED':
          return { message: 'Microphone access is needed to make voice calls', type: 'error' };
        case 'LIVEKIT_CONNECTION_FAILED':
          return { message: 'Could not establish the call', type: 'error' };
        case 'NETWORK_ERROR':
          return { message: 'Call failed due to a network problem', type: 'error' };
        default:
          return { message: 'Call failed', type: 'error' };
      }
    case 'ENDED':
      return {
        message: call.durationSec ? `Call ended · ${formatDuration(call.durationSec)}` : 'Call ended',
        type: 'info',
      };
    default:
      return null;
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const accessToken = useAccessToken();
  // The stable Supabase auth identity (session.user.id) — updates the
  // instant login/logout/switch happens, unlike dbUserId below (an async
  // /me REST profile fetch that lags behind auth and can briefly still
  // reflect the OLD identity after a switch). This is the security boundary
  // native intent handlers check against; dbUserId remains useful for
  // resolving caller/callee roles against a fetched CallSummary and for
  // filtering the /calls/active recovery + Realtime subscription, but must
  // never be the only thing gating a native handler's side effects — see
  // captureNativeIntentSession/isNativeIntentSessionStillValid below.
  const authUserId = useAuthUserId();
  const { data: currentUserData } = useCurrentUser();
  const dbUserId = currentUserData?.user.id ?? null;

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  // CallKit-managed call tracking + audio-session activation (see
  // lib/callAudioCoordinator.ts) — React state (not a plain ref) because its
  // changes must actually re-render so components/voice-call-modal.tsx's
  // `<LiveKitRoom connect={isPrivateCallAudioAuthorized}>` picks them up.
  const [callKitAudioState, setCallKitAudioState] = useState<CallKitAudioState>(INITIAL_CALLKIT_AUDIO_STATE);

  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const authUserIdRef = useRef(authUserId);
  authUserIdRef.current = authUserId;
  const dbUserIdRef = useRef(dbUserId);
  dbUserIdRef.current = dbUserId;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appActiveRef = useRef(AppState.currentState);
  // In-flight de-dup for LiveKit token requests: Realtime, the ringing/accepted
  // poll loops, and the accept response can all observe ACCEPTED around the
  // same moment. Only one token request per call should ever be outstanding,
  // and a call that already has credentials must never be re-requested.
  const tokenRequestRef = useRef<{ callId: string; promise: Promise<void> } | null>(null);
  // Shared in-flight lock for decline/cancel/end (runLifecycleAction) AND
  // media-failure reporting (attemptMediaFailureReport) — both sides must
  // serialize against each other for the same call (e.g. a decline tap and
  // a fail report must not both act at once), so they share one slot. Holds
  // a full LifecycleActionMarker (not just a callId) so a stale marker from
  // a previous identity/session can never block a genuinely new attempt,
  // and so each side's `finally` only ever clears a marker it created
  // itself — never one a newer attempt (possibly held by the *other* owner)
  // has since taken over.
  const nextLifecycleActionRequestIdRef = useRef(0);
  const lifecycleActionInFlightRef = useRef<LifecycleActionMarker | null>(null);
  // Identity of whichever active-call recovery request (GET /calls/active)
  // is currently outstanding, if any — { userId, generation, requestId } —
  // and the generation counter it's tagged with. A plain boolean can't tell
  // whose request is in flight: a slow request from a previous user would
  // either block the new user's genuinely new recovery from ever starting,
  // or (worse) have its `finally` clear a marker that actually belongs to a
  // newer request. The generation counter (bumped on every authUserId
  // identity change, see the effect below) is what makes the classic ABA
  // case safe: user A -> B -> A would otherwise leave a slow request from
  // the *first* A session looking identical (same userId) to a request
  // belonging to the second A session.
  const recoveryGenerationRef = useRef(0);
  const recoveryRequestRef = useRef<{ userId: string; generation: number; requestId: number } | null>(null);
  const nextRecoveryRequestIdRef = useRef(0);
  // Previous authUserId (Supabase auth identity), compared each render to
  // detect a REAL identity change (login, logout, or switching between two
  // accounts) — see the effect below. Deliberately keyed off authUserId, NOT
  // dbUserId: dbUserId is an async /me REST fetch that can still reflect the
  // previous identity for a moment after auth itself has already switched,
  // which would let a native intent handler's late response write into the
  // new session if this boundary waited for dbUserId instead.
  const previousAuthUserIdRef = useRef<string | null>(null);
  // A media/connection failure the app has already *decided* is real (mic
  // denied, LiveKit connection dead) but hasn't necessarily gotten the
  // server to acknowledge yet — persists across a POST /fail failure AND a
  // failed GET reconciliation, so it survives to be retried once the
  // network recovers instead of silently being lost. Cleared only once the
  // server confirms a terminal outcome, or the call/identity it belongs to
  // no longer applies (see resetToIdle).
  const pendingMediaFailureRef = useRef<{ callId: string; reason: CallFailureReason } | null>(null);
  const mediaFailureRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppresses a redundant native CallKit "end this call" round trip
  // (see applyTerminalOutcome below) for a callId whose termination this
  // device's own native intent handler (handleNativeEnd) just caused —
  // CallKit already knows in that case, since the user acted on its own
  // system UI to get here. Keyed by callId only (a fresh call always mints
  // a fresh UUID, so no cross-call collision risk), value is the epoch ms
  // the marker expires at. Consumed (deleted) on first check regardless of
  // whether it was still valid, so it can never permanently swallow a
  // later, genuinely-unrelated terminal sync for the same callId.
  const nativeEndSuppressionRef = useRef<Map<string, number>>(new Map());
  // Breaks the mutual-recursion cycle between scheduleMediaFailureRetry and
  // attemptMediaFailureReport (the retry timer needs to call the attempt
  // function, which schedules further retries) — see the definitions below.
  const attemptMediaFailureReportRef = useRef<(callId: string) => Promise<void>>(async () => {});

  // The confirmation obligation a watchdog/onDisconnected/partner-left-grace
  // signal has already decided is needed — { callId, requestId, generation}.
  // This single marker doubles as both "is a confirmation pending for this
  // call" (the old pendingConfirmationRef's job) and "which exact attempt is
  // currently authoritative" (the old confirmRetryInFlightRef boolean's job)
  // — every await inside attemptConfirmCallOrFail re-checks this exact
  // marker before acting, so a late response whose marker has been
  // superseded (reportMediaConnected, resetToIdle, or a newer confirm
  // attempt) is always discarded.
  const nextConfirmRequestIdRef = useRef(0);
  const pendingConfirmationRef = useRef<{ callId: string; requestId: number; generation: number } | null>(
    null
  );
  const confirmRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptConfirmCallOrFailRef = useRef<
    (callId: string, requestId: number, generation: number) => Promise<void>
  >(async () => {});

  // The callId the App-Accept -> CallKit answerIncomingCall sync has already
  // run for (see acceptCall/shouldSyncAnswerIncomingCall below) — only one
  // call can be active at a time, so a single "last synced callId" (reset on
  // resetToIdle), not a growing set, is sufficient and never leaks memory
  // across a long-running app session.
  const answerIncomingCallSyncedForRef = useRef<string | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const resetToIdle = useCallback(() => {
    clearPoll();
    if (terminalTimerRef.current) {
      clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = null;
    }
    // Whatever call this in-flight state belonged to is being discarded —
    // a token request or a decline/cancel/end/fail attempt in flight for it
    // must not be able to write back into whatever (or whoever) comes next.
    tokenRequestRef.current = null;
    lifecycleActionInFlightRef.current = null;
    // Same reasoning for an in-flight accept attempt — logout, an account
    // switch, or any other terminal cleanup must make it immediately
    // ineligible (isAcceptMarkerStillValid checks acceptInFlightRef), and a
    // brand-new attempt for whatever comes next must never see a stale one
    // still "holding" the lock.
    acceptInFlightRef.current = null;
    acceptInFlightPromiseRef.current = null;
    // Likewise for a pending media-failure report or pending confirmation
    // and their retry timers — this call/identity is gone, so retrying
    // against it (or writing its result back) no longer makes sense.
    pendingMediaFailureRef.current = null;
    if (mediaFailureRetryTimerRef.current) {
      clearTimeout(mediaFailureRetryTimerRef.current);
      mediaFailureRetryTimerRef.current = null;
    }
    pendingConfirmationRef.current = null;
    if (confirmRetryTimerRef.current) {
      clearTimeout(confirmRetryTimerRef.current);
      confirmRetryTimerRef.current = null;
    }
    // This call/identity is gone — stop tracking it as a CallKit-managed call
    // (a no-op via resolveCallKitManagedCallEnd if nothing was tracked) and
    // let a future call's App-Accept sync run fresh rather than seeing a
    // stale "already synced" callId from whatever this session's last call
    // was.
    setCallKitAudioState(prev => resolveCallKitManagedCallEnd(prev));
    answerIncomingCallSyncedForRef.current = null;
    setActiveCall(null);
    setPhase('idle');
  }, [clearPoll]);

  // CallProvider lives above the auth-gated navigator (see app/_layout.tsx),
  // so it never unmounts on logout/account switch — clear any in-progress
  // call state ourselves instead of leaving a stale modal behind.
  useEffect(() => {
    if (!accessToken) resetToIdle();
  }, [accessToken, resetToIdle]);

  // Identity-change cleanup: fires whenever authUserId (the Supabase auth
  // identity) actually changes — login, logout, or switching between two
  // accounts. Bumping the generation here (before anything else) is what
  // invalidates any recovery request or native intent handler already in
  // flight for the previous identity, including the ABA case where
  // authUserId goes A -> B -> A and a slow request from the *first* A
  // session must not be mistaken for one belonging to the second. The
  // actual teardown (poll, timers, activeCall, in-flight markers) only runs
  // for a real switch/logout, not the initial mount (previous === null) —
  // authUserId starts at null before AuthProvider's initial getSession()
  // resolves, so a fresh app start landing on an already-logged-in session
  // is a baseline, not a "switch away from nothing" that needs a reset.
  //
  // Deliberately the ONLY identity-cleanup effect in this file — previously
  // this same job was keyed off dbUserId (the async /me profile fetch);
  // that effect has been replaced (not duplicated) by this one so a single
  // switch is never bumped/reset twice. dbUserId retains its own separate
  // effects below (recovery trigger, Realtime subscription) since those
  // need the resolved profile id itself, not just the identity boundary.
  //
  // This effect deliberately does NOT itself call recovery for the new
  // identity — see the next effect below for why that has to happen on a
  // separate render.
  useEffect(() => {
    const previous = previousAuthUserIdRef.current;
    previousAuthUserIdRef.current = authUserId;
    if (previous === authUserId) return;

    recoveryGenerationRef.current += 1;

    if (previous !== null) {
      resetToIdle();
    }
  }, [authUserId, resetToIdle]);

  // Snapshot of everything a native intent handler (handleNativeIncoming/
  // handleNativeAnswer/handleNativeEnd) must capture BEFORE its first await,
  // and re-validate after every subsequent one — the shared identity guard
  // requested for Gate Review blocker 1. Three checks, not just
  // recoveryGenerationRef alone: authUserId is the actual security boundary
  // (updates the instant auth switches, see the effect above); generation is
  // the ABA-safe counter tied to it; dbUserId is re-checked too since it's
  // what the handler actually used to resolve caller/callee roles, and it
  // must not have drifted out from under that resolution even in the
  // (should-be-impossible) case where it changes independently of authUserId.
  type NativeIntentSession = { authUserId: string | null; generation: number; dbUserId: string | null };

  const captureNativeIntentSession = useCallback((): NativeIntentSession => ({
    authUserId: authUserIdRef.current,
    generation: recoveryGenerationRef.current,
    dbUserId: dbUserIdRef.current,
  }), []);

  const isNativeIntentSessionStillValid = useCallback((session: NativeIntentSession): boolean => {
    return (
      authUserIdRef.current === session.authUserId &&
      recoveryGenerationRef.current === session.generation &&
      dbUserIdRef.current === session.dbUserId
    );
  }, []);

  // acceptCallAction's own late-response marker — shared by BOTH the plain
  // UI "Accept" button (context value's `acceptCall`) and
  // handleNativeAnswer, since both call the exact same acceptCallAction
  // function below; fixing it here protects both call sites without a
  // second copy of this logic. Extends NativeIntentSession (identity) with
  // the callId the accept was actually issued for and a requestId unique to
  // THIS attempt, because identity staying the same is not enough — a late
  // accept response must not resurrect a call that has since ended/been
  // reset/been replaced by a different one, AND a concurrent second attempt
  // for the exact same call (the plain UI Accept button racing
  // handleNativeAnswer, or vice versa) must be tracked as a distinct
  // attempt so only one of them is ever allowed to be "the" authoritative
  // in-flight request — see acceptInFlightRef/stillHoldsAcceptMarker below.
  type AcceptMarker = NativeIntentSession & { callId: string; requestId: number };

  const nextAcceptRequestIdRef = useRef(0);
  // The single accept attempt currently recognized as authoritative for
  // whichever (callId, identity generation) it was minted for. A second
  // acceptCallAction() call for the SAME callId + SAME generation reuses
  // this attempt (see acceptCallAction) instead of sending a second
  // POST /accept; `finally` only clears this if it still holds exactly this
  // marker (stillHoldsAcceptMarker), so a newer attempt (a different
  // requestId, possibly a different identity generation after a switch, or
  // resetToIdle already clearing it outright) is never wiped by an older
  // one settling late.
  const acceptInFlightRef = useRef<AcceptMarker | null>(null);
  // The in-flight attempt's own Promise, kept alongside acceptInFlightRef
  // purely so a second, deduped caller can await the exact same outcome
  // (and therefore the same setActiveCall/setPhase/ensureLiveKitToken, or
  // lack thereof) instead of racing a redundant POST.
  const acceptInFlightPromiseRef = useRef<Promise<void> | null>(null);

  const captureAcceptMarker = useCallback(
    (callId: string, requestId: number): AcceptMarker => ({ ...captureNativeIntentSession(), callId, requestId }),
    [captureNativeIntentSession]
  );

  // Narrow ownership check: does acceptInFlightRef still literally hold
  // THIS exact marker? Deliberately separate from isAcceptMarkerStillValid
  // below (which also folds in call/role/terminal checks that are
  // irrelevant to lock *ownership*) — used specifically to decide whether
  // `finally` may release the lock without risking clearing a newer
  // attempt's marker out from under it.
  const stillHoldsAcceptMarker = useCallback((marker: AcceptMarker): boolean => {
    const held = acceptInFlightRef.current;
    return (
      !!held &&
      held.callId === marker.callId &&
      held.requestId === marker.requestId &&
      held.generation === marker.generation &&
      held.authUserId === marker.authUserId &&
      held.dbUserId === marker.dbUserId
    );
  }, []);

  const isAcceptMarkerStillValid = useCallback(
    (marker: AcceptMarker): boolean => {
      if (!isNativeIntentSessionStillValid(marker)) return false;
      const current = activeCallRef.current;
      if (!current || current.call.id !== marker.callId || current.role !== 'callee') return false;
      // Even with identity unchanged and the same call still active locally,
      // a concurrent signal (Realtime/poll/another native intent) may have
      // already moved this exact call to a terminal status while this
      // accept attempt was in flight — applyTerminalOutcome will already
      // have run for it via that other path, so resurrecting it here would
      // both be wrong and redundantly re-fire toast/native-end side effects.
      if (TERMINAL_STATUSES.has(current.call.status)) return false;
      // And it must still be the exact attempt acceptInFlightRef recognizes
      // as authoritative — if a concurrent second acceptCallAction() call
      // deduped onto (i.e. is awaiting) this same attempt, that's fine (it
      // shares this marker), but a genuinely NEWER attempt (different
      // requestId) must be the only one allowed to act.
      return stillHoldsAcceptMarker(marker);
    },
    [isNativeIntentSessionStillValid, stillHoldsAcceptMarker]
  );

  // Marks `callId` so the next applyTerminalOutcome for it skips notifying
  // native CallKit — used right before delegating a native-originated
  // endCall intent into decline/cancel/end, since CallKit already knows
  // (the user just acted on its own system UI to produce that intent in
  // the first place). Guards against a programmatic-end -> endCall-event ->
  // REST-action feedback loop even though this SDK's outbound
  // reportEndCallWithUUID/endCall calls do not appear to re-emit a JS
  // `endCall` event in practice — cheap insurance either way.
  const suppressNativeEndSync = useCallback((callId: string) => {
    nativeEndSuppressionRef.current.set(callId, Date.now() + NATIVE_END_SUPPRESSION_MS);
  }, []);

  // Consume-once: returns true (and always deletes the entry, valid or not)
  // if `callId`'s termination was already caused by processing a native
  // endCall intent moments ago. A single check-and-delete means this can
  // never permanently swallow a later, unrelated terminal sync attempt for
  // the same callId (new calls always mint a fresh UUID anyway, so that
  // scenario is purely defensive).
  const consumeNativeEndSuppression = useCallback((callId: string) => {
    const expiresAt = nativeEndSuppressionRef.current.get(callId);
    nativeEndSuppressionRef.current.delete(callId);
    return typeof expiresAt === 'number' && expiresAt > Date.now();
  }, []);

  // Called by handleNativeIncoming/handleNativeAnswer the instant either
  // confirms `callId` as a call CallKit actually displayed — starts (or
  // continues) tracking it in callKitAudioState (see
  // resolveCallKitManagedCallStart), and retroactively flips
  // activeCall.isCallKitManaged to true if a LOCAL record for this exact call
  // already existed (e.g. established a moment earlier by recoverActiveCall/
  // refreshIncoming, which don't go through the coordinator's native path and
  // so default it to false) rather than only ever setting it on a freshly
  // constructed ActiveCall literal.
  const markCallKitManaged = useCallback((callId: string) => {
    setCallKitAudioState(prev => resolveCallKitManagedCallStart(prev, callId));
    setActiveCall(prev =>
      prev && prev.call.id === callId && !prev.isCallKitManaged ? { ...prev, isCallKitManaged: true } : prev
    );
  }, []);

  // Called by the coordinator the instant it sees a legal callId from a
  // native incoming/didDisplay/answer event — BEFORE handleNativeIncoming/
  // handleNativeAnswer's own REST GET has even started, let alone completed.
  // This is what lets a didActivateAudioSession that arrives while that GET
  // is still in flight land on the right callId (previously, tracking only
  // started AFTER the GET succeeded, so an activate arriving earlier found
  // nothing tracked and was silently dropped — see
  // resolveCallKitAudioActivation's managedCallId===null guard). Only ever
  // starts audio tracking — never creates activeCall, requests a LiveKit
  // token, or calls accept.
  const handleNativeCallKitCallIdSeen = useCallback((callId: string) => {
    setCallKitAudioState(prev => resolveCallKitManagedCallStart(prev, callId));
  }, []);

  // Clears the tracking handleNativeCallKitCallIdSeen/markCallKitManaged
  // started, but ONLY if it's still tracking this exact callId (never a
  // different, still-valid call) — used at every point REST validation
  // definitively rules this callId out (404/non-participant, terminal,
  // identity switched) so a later stray didActivateAudioSession for it can't
  // resurrect a private-call audio authorization for a call that's gone.
  const clearCallKitTrackingIfMatches = useCallback((callId: string) => {
    setCallKitAudioState(prev => (prev.managedCallId === callId ? resolveCallKitManagedCallEnd(prev) : prev));
  }, []);

  const applyTerminalOutcome = useCallback(
    (call: CallSummary, role: 'caller' | 'callee') => {
      // isCallKitManaged is irrelevant from here on — the call is terminal,
      // VoiceCallModal renders PreConnectScreen (livekit: null) rather than
      // ConnectedCallScreen for it, and resetToIdle (scheduled below) clears
      // callKitAudioState/activeCall shortly regardless.
      setActiveCall({ call, livekit: null, role, isCallKitManaged: false });
      setPhase(call.status === 'FAILED' ? 'failed' : 'ended');
      clearPoll();

      const toast = terminalToastFor(call);
      if (toast) showToast(toast.message, toast.type);

      // The server records a SYSTEM message for this call's outcome (see
      // recordCallOutcomeMessage in apps/backend/src/lib/calls.ts), but
      // nothing else on this device will have observed that insert unless
      // this match's chat screen happens to already be open (its own
      // Realtime subscription is what normally drives chatNeedsRefresh —
      // see registerIncomingMessage). Every call this device is a party to
      // reaches applyTerminalOutcome regardless of which screen is open, so
      // this is the one place that can reliably tell the chat list to
      // refresh and pick up the new last-message/unread state.
      markChatNeedsRefresh(call.matchId);

      if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = setTimeout(resetToIdle, TERMINAL_DISPLAY_MS);

      // Keep native CallKit in sync with the server's terminal truth —
      // unless this exact termination is the one CallKit's own end/decline
      // action just caused (see suppressNativeEndSync/handleNativeEnd).
      // No-op on Android/Expo Go/when the native module isn't linked.
      if (!consumeNativeEndSuppression(call.id)) {
        endNativeCallKitCall(call.id, call.status === 'FAILED' ? 'failed' : call.status === 'MISSED' ? 'unanswered' : 'remoteEnded');
      }
    },
    [clearPoll, resetToIdle, consumeNativeEndSuppression]
  );

  // Fetches LiveKit credentials for an ACCEPTED call, exactly once per call:
  // skipped outright if this call already has credentials, and de-duped
  // against any already-in-flight request for the same call (Realtime, the
  // poll loop, and a direct accept response can all trigger this around the
  // same time). Accept itself never returns credentials — this is the only
  // path that fetches them, called separately once ACCEPTED is observed by
  // any signal.
  const ensureLiveKitToken = useCallback(
    (call: CallSummary, role: 'caller' | 'callee') => {
      const token = accessTokenRef.current;
      if (!token || call.status !== 'ACCEPTED') return;

      const current = activeCallRef.current;
      if (current?.call.id === call.id && current.livekit) return; // already have credentials
      if (tokenRequestRef.current?.callId === call.id) return; // request already in flight

      const promise = (async () => {
        try {
          const livekit = await getCallLiveKitCredentials(token, call.id);
          const latest = activeCallRef.current;
          // A late-arriving token response must never resurrect a call that
          // has since moved on: if the call ended/failed/was
          // declined/canceled/missed (or terminalOutcome/resetToIdle already
          // cleared activeCall) while this request was in flight, the
          // credentials are stale — discard them instead of writing them
          // back and re-mounting LiveKitRoom or changing phase out from
          // under the terminal/idle state.
          if (!latest || latest.call.id !== call.id || latest.livekit || latest.call.status !== 'ACCEPTED') {
            return;
          }
          setActiveCall({ call: latest.call, livekit, role: latest.role, isCallKitManaged: latest.isCallKitManaged });
        } catch {
          // transient — the next poll/realtime tick still sees !livekit and
          // will call this again
        } finally {
          if (tokenRequestRef.current?.callId === call.id) {
            tokenRequestRef.current = null;
          }
        }
      })();

      tokenRequestRef.current = { callId: call.id, promise };
    },
    []
  );

  // Re-fetches the call from the REST API (never trusts a Realtime payload
  // directly) and folds the result into local state.
  const refreshCall = useCallback(
    async (callId: string) => {
      const token = accessTokenRef.current;
      if (!token) return;

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
        return; // transient network error — next poll/realtime tick retries
      }

      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) return;

      if (TERMINAL_STATUSES.has(call.status)) {
        applyTerminalOutcome(call, current.role);
        return;
      }

      setActiveCall({ call, livekit: current.livekit, role: current.role, isCallKitManaged: current.isCallKitManaged });

      if (call.status === 'ACCEPTED') {
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!current.livekit) ensureLiveKitToken(call, current.role);
      }
    },
    [applyTerminalOutcome, ensureLiveKitToken]
  );

  // Called when POST /accept itself fails (network error, timeout, or a
  // dropped response) — never assume the request didn't land server-side.
  // Reconciles against the server instead of resetting to idle, so a callee
  // whose accept actually succeeded server-side (caller already sees
  // ACCEPTED and is connecting) doesn't silently fall back to idle while the
  // caller proceeds, which would split the two sides' call state.
  //
  // Takes the SAME AcceptMarker the failed acceptCallAction attempt already
  // captured, rather than deriving a fresh one here — capturing a new one
  // after the failure would read whatever identity/activeCall happens to be
  // current at that later moment, which could already belong to a different
  // session/call than the one this reconciliation is actually about.
  const reconcileAfterAcceptFailure = useCallback(
    async (callId: string, marker: AcceptMarker) => {
      const token = accessTokenRef.current;
      if (!token) return;
      if (!isAcceptMarkerStillValid(marker)) return; // before issuing the reconciliation GET

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
        if (!isAcceptMarkerStillValid(marker)) return; // before the retry-toast/setPhase side effect
        // The reconciliation read itself failed too (still no network). Do
        // not assume the call is gone — keep the current incoming-call UI
        // up and let the ringing poll loop keep retrying.
        const current = activeCallRef.current;
        if (current?.call.id === callId && current.role === 'callee') {
          setPhase('incomingRinging');
        }
        showToast('Connection issue — retrying…', 'error');
        return;
      }
      if (!isAcceptMarkerStillValid(marker)) return; // before applying the GET result

      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) return;

      if (TERMINAL_STATUSES.has(call.status)) {
        applyTerminalOutcome(call, current.role);
        return;
      }

      if (call.status === 'ACCEPTED') {
        // The accept actually landed server-side despite the client-visible
        // error — adopt the ACCEPTED state instead of diverging from the
        // caller, who will have observed the same ACCEPTED state.
        setActiveCall({ call, livekit: current.livekit, role: current.role, isCallKitManaged: current.isCallKitManaged });
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!current.livekit) ensureLiveKitToken(call, current.role);
        return;
      }

      // Still RINGING — the accept genuinely never landed. Restore the
      // incoming-call UI so the user can retry, with a clear error instead
      // of silently vanishing.
      setActiveCall({ call, livekit: null, role: current.role, isCallKitManaged: current.isCallKitManaged });
      setPhase('incomingRinging');
      showToast('Could not accept the call — please try again', 'error');
    },
    [isAcceptMarkerStillValid, applyTerminalOutcome, ensureLiveKitToken]
  );

  const refreshIncoming = useCallback(async () => {
    const token = accessTokenRef.current;
    if (!token || activeCallRef.current) return;

    let calls: CallSummary[];
    try {
      calls = await getIncomingCalls(token);
    } catch {
      return;
    }

    const incoming = calls[0];
    if (!incoming || activeCallRef.current) return;

    setActiveCall({ call: incoming, livekit: null, role: 'callee', isCallKitManaged: false });
    setPhase('incomingRinging');
  }, []);

  // Recovers a RINGING or ACCEPTED Call that exists in the database but has
  // no in-memory representation — a fresh CallProvider mount (app cold
  // start), a user switch, or a background/foreground cycle that happened
  // to lose in-memory state all leave the Call row as the only place this
  // information survives. Unlike refreshIncoming (callee-only RINGING),
  // this recovers either role and either active status via GET
  // /calls/active. Never overwrites an activeCall that's already been
  // established locally (by this call or a newer one) in the meantime.
  const recoverActiveCall = useCallback(async () => {
    const token = accessTokenRef.current;
    const userId = dbUserIdRef.current;
    if (!token || !userId) return;
    if (activeCallRef.current) return; // local state already has something newer

    const generation = recoveryGenerationRef.current;
    const inFlight = recoveryRequestRef.current;
    // Only skip if the outstanding request belongs to this same identity
    // *and* generation — a stale request from a previous identity (or an
    // earlier session of the same userId, pre-ABA-round-trip) must never
    // block a genuinely new recovery from starting.
    if (inFlight && inFlight.userId === userId && inFlight.generation === generation) return;

    const requestId = ++nextRecoveryRequestIdRef.current;
    const marker = { userId, generation, requestId };
    recoveryRequestRef.current = marker;

    try {
      let call: CallSummary | null;
      try {
        call = await getActiveCallApi(token);
      } catch {
        return; // transient network error — next mount/foreground/idle-poll tick retries
      }

      // Late-response guard, re-checked in full right before writing
      // anything back: logged out, switched to a different identity
      // (including an A -> B -> A round trip, caught by the generation
      // check — dbUserId alone would be fooled by that), or a local call
      // was established (Realtime, a manual startCall, another recovery)
      // while this request was in flight — never overwrite any of those
      // with a stale recovery result.
      if (!accessTokenRef.current) return;
      if (dbUserIdRef.current !== userId) return;
      if (recoveryGenerationRef.current !== generation) return;
      if (activeCallRef.current) return;

      if (!call) return; // no active call server-side — stay however local state already is (idle)

      const role: 'caller' | 'callee' = call.caller.id === userId ? 'caller' : 'callee';

      if (call.status === 'RINGING') {
        setActiveCall({ call, livekit: null, role, isCallKitManaged: false });
        setPhase(role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
        return;
      }

      if (call.status === 'ACCEPTED') {
        setActiveCall({ call, livekit: null, role, isCallKitManaged: false });
        setPhase('connecting');
        ensureLiveKitToken(call, role);
      }
    } finally {
      // Only clear the marker if it's still the exact one this call created
      // — a newer request (a different identity, generation, or even a
      // retried request for the same identity) must never have its
      // in-flight marker wiped out by this one settling late.
      if (
        recoveryRequestRef.current &&
        recoveryRequestRef.current.userId === marker.userId &&
        recoveryRequestRef.current.generation === marker.generation &&
        recoveryRequestRef.current.requestId === marker.requestId
      ) {
        recoveryRequestRef.current = null;
      }
    }
  }, [ensureLiveKitToken]);

  // Shared entry point for "the app/provider just became relevant again"
  // moments (mount, user switch, foreground resume, idle poll): prefers
  // refreshing an already-known call over recovery, so a freshly-established
  // local call (e.g. one just observed via Realtime a moment earlier) is
  // never clobbered by a recovery request that started before it existed.
  const recoverOrRefresh = useCallback(() => {
    const current = activeCallRef.current;
    if (current) {
      refreshCall(current.call.id);
    } else {
      recoverActiveCall();
    }
  }, [refreshCall, recoverActiveCall]);

  // Provider (re-)initialization and identity changes: as soon as we have
  // both an access token and the internal dbUserId, try to recover
  // immediately — do not wait for the idle poll's first tick (up to
  // IDLE_POLL_MS later). Depends on `activeCall` (the state value, not just
  // the ref) so that when the identity-change effect above just ran
  // resetToIdle() in the same commit (dbUserId changing triggers both
  // effects in the same pass), this effect still sees the *previous*
  // render's activeCall — React state updates are async, and activeCallRef
  // only resyncs at the top of the next render — and therefore skips. It
  // then fires again on the following render, once setActiveCall(null) has
  // actually committed and activeCallRef reads null, which is the only
  // point at which it's safe to recover for the new identity. This is what
  // prevents ever refreshing a stale callId with a new user's token.
  useEffect(() => {
    if (!accessToken || !dbUserId || activeCall) return;
    recoverOrRefresh();
  }, [accessToken, dbUserId, activeCall, recoverOrRefresh]);

  // Poll loop. Frequency depends on phase; stops entirely while backgrounded
  // (per spec: JS polling cannot deliver background/locked-screen calls —
  // that needs PushKit/CallKit, phase 3).
  useEffect(() => {
    clearPoll();
    if (!appActive) return;

    if (phase === 'idle') {
      // Recovery, not just incoming: this must also catch an outgoing
      // RINGING or an ACCEPTED call left over from before a state loss
      // (see recoverActiveCall above), not only a callee's incoming ring.
      pollTimerRef.current = setInterval(recoverActiveCall, IDLE_POLL_MS);
    } else if (phase === 'outgoingRinging' || phase === 'incomingRinging') {
      const callId = activeCall?.call.id;
      if (callId) pollTimerRef.current = setInterval(() => refreshCall(callId), RINGING_POLL_MS);
    } else if (phase === 'connecting' || phase === 'connected' || phase === 'reconnecting') {
      const callId = activeCall?.call.id;
      if (callId) pollTimerRef.current = setInterval(() => refreshCall(callId), ACCEPTED_POLL_MS);
    }

    return clearPoll;
  }, [phase, activeCall?.call.id, appActive, clearPoll, recoverActiveCall, refreshCall]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const becameActive = next === 'active' && appActiveRef.current !== 'active';
      appActiveRef.current = next;
      setAppActive(next === 'active');

      if (becameActive) {
        // Recover on foreground resume too: covers an outgoing RINGING or
        // ACCEPTED call, not just a callee's incoming ring — see
        // recoverActiveCall / recoverOrRefresh above.
        recoverOrRefresh();
      }
    });
    return () => sub.remove();
  }, [recoverOrRefresh]);

  // Realtime signaling: one global subscription per logged-in user, filtered
  // to rows where they're the caller or callee. Postgres Changes only ever
  // trigger a re-fetch here — the payload itself is never trusted (see
  // docs/private-voice-calling-spec.md "前台实时信令").
  useEffect(() => {
    if (!dbUserId || !accessToken) return;

    let closed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function start() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || closed) return;

      supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`calls:${dbUserId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${dbUserId}` },
          () => {
            if (!activeCallRef.current) refreshIncoming();
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${dbUserId}` },
          payload => {
            const callId = (payload.new as { id?: string } | null)?.id;
            if (callId && activeCallRef.current?.call.id === callId) refreshCall(callId);
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'calls', filter: `caller_id=eq.${dbUserId}` },
          payload => {
            const callId = (payload.new as { id?: string } | null)?.id;
            if (callId && activeCallRef.current?.call.id === callId) refreshCall(callId);
          }
        )
        .subscribe();
    }

    start();

    return () => {
      closed = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [dbUserId, accessToken, refreshIncoming, refreshCall]);

  const startCall = useCallback(async (matchId: string) => {
    const token = accessTokenRef.current;
    if (!token) return;
    if (IS_EXPO_GO) {
      showToast('Voice calls are not available in Expo Go. Use a dev build.', 'error');
      return;
    }
    if (activeCallRef.current) {
      showToast('You are already in a call.', 'error');
      return;
    }

    try {
      const call = await startCallApi(token, matchId);
      setActiveCall({ call, livekit: null, role: 'caller', isCallKitManaged: false });
      setPhase('outgoingRinging');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start call', 'error');
    }
  }, []);

  // Shared by the plain UI "Accept" button (exposed as `acceptCall` on the
  // context value) AND handleNativeAnswer, which calls this exact function
  // — fixing the late-response/concurrency protection here covers both call
  // sites without a second copy of it.
  //
  // Concurrency: a duplicate UI tap racing handleNativeAnswer (or vice
  // versa) for the SAME still-RINGING call must never send a second
  // POST /accept — acceptInFlightRef/acceptInFlightPromiseRef dedupe onto
  // the one authoritative attempt, and the second caller awaits that exact
  // same Promise (so handleNativeAnswer's own confirm-GET afterward still
  // only runs once the one real accept has fully settled).
  //
  // Late-response protection: the marker is captured ONCE per NEW attempt,
  // before the POST /accept even starts, and re-validated after every
  // subsequent await (isAcceptMarkerStillValid — identity, callId/role/
  // non-terminal, AND still-held-in-flight-lock ownership) before any of
  // setActiveCall/setPhase/ensureLiveKitToken/reconcileAfterAcceptFailure
  // runs. Without this, a slow accept response landing after an identity
  // switch (resetToIdle already cleared activeCall AND the lock) — or after
  // this same identity's activeCall simply moved on to a different call, or
  // after a NEWER accept attempt has taken over the lock — could still
  // resurrect stale ACCEPTED state on top of whatever the session has since
  // moved on to.
  const acceptCallAction = useCallback((): Promise<void> => {
    const token = accessTokenRef.current;
    const current = activeCallRef.current;
    if (!token || !current || current.role !== 'callee') return Promise.resolve();

    const callId = current.call.id;
    const generation = recoveryGenerationRef.current;

    // Reuse an already in-flight attempt for the SAME call under the SAME
    // identity generation instead of sending a second POST /accept.
    const existing = acceptInFlightRef.current;
    if (existing && existing.callId === callId && existing.generation === generation) {
      return acceptInFlightPromiseRef.current ?? Promise.resolve();
    }

    const requestId = ++nextAcceptRequestIdRef.current;
    const marker = captureAcceptMarker(callId, requestId);

    const attempt = (async () => {
      setPhase('accepting');
      try {
        // acceptCall is now a pure state transition — it never carries
        // LiveKit credentials. Enter 'connecting' immediately on the
        // ACCEPTED result, then fetch credentials separately via
        // ensureLiveKitToken.
        const result = await acceptCallApi(token, callId);
        if (!isAcceptMarkerStillValid(marker)) return; // superseded while the POST was in flight — do not resurrect

        // Preserve whatever LiveKit credentials/connected-or-better phase a
        // concurrent signal (Realtime/poll, or the dedup above having let a
        // second caller observe this same attempt) may already have
        // established for this exact call — never null out credentials
        // that already exist, and never regress connected/reconnecting back
        // to connecting.
        const latest = activeCallRef.current;
        const preservedLivekit = latest?.call.id === callId ? latest.livekit : null;
        const preservedIsCallKitManaged = latest?.call.id === callId ? latest.isCallKitManaged : false;
        setActiveCall({ call: result, livekit: preservedLivekit, role: 'callee', isCallKitManaged: preservedIsCallKitManaged });
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!preservedLivekit) ensureLiveKitToken(result, 'callee');
      } catch {
        if (!isAcceptMarkerStillValid(marker)) return; // superseded — do not even attempt reconciliation for a stale session
        // Do not assume the accept never landed — a network error or a
        // dropped response can happen after the server already recorded
        // ACCEPTED. Reconcile against the server instead of resetting to
        // idle, which would otherwise split this side's state from the
        // caller's (who may already have observed ACCEPTED). Passes the SAME
        // marker along rather than letting reconcileAfterAcceptFailure
        // capture a fresh one after the fact.
        await reconcileAfterAcceptFailure(callId, marker);
      } finally {
        // Only release the lock if it's still exactly this attempt's marker
        // — a newer attempt (a different requestId, possibly a different
        // identity generation after a switch) or resetToIdle already having
        // cleared it outright must never have its lock cleared by this one
        // settling late.
        if (stillHoldsAcceptMarker(marker)) {
          acceptInFlightRef.current = null;
          acceptInFlightPromiseRef.current = null;
        }
      }
    })();

    acceptInFlightRef.current = marker;
    acceptInFlightPromiseRef.current = attempt;
    return attempt;
  }, [captureAcceptMarker, isAcceptMarkerStillValid, stillHoldsAcceptMarker, ensureLiveKitToken, reconcileAfterAcceptFailure]);

  // Reconciles decline/cancel/end against the Call row — the single source
  // of truth — after that action's own request fails, times out, 409s, or
  // its response is otherwise lost, and defensively if a "200" response
  // somehow doesn't carry the expected terminal status either. Never assumes
  // the request did or didn't land server-side: a lost decline could still
  // leave the call RINGING (retry available), a lost cancel could mean the
  // callee already accepted (ACCEPTED), and a lost end could mean the call
  // is still ACCEPTED on the other side.
  // `marker` identifies exactly which runLifecycleAction attempt this
  // reconciliation belongs to — { callId, requestId, generation, owner }.
  // Every stage re-validates against it (and against the live identity
  // generation) before touching phase/activeCall or applying an outcome, so
  // a request that's been superseded — by resetToIdle, an identity switch,
  // or a newer attempt (possibly held by attemptMediaFailureReport, since
  // both share the same lock) — can never write back into whatever the
  // same callId now represents under a different session.
  const reconcileLifecycleAction = useCallback(
    async (marker: LifecycleActionMarker, previousPhase?: CallPhase) => {
      const { callId } = marker;
      // Full ownership check — not just the generation: the shared lock
      // must still hold *this exact* marker (callId + requestId +
      // generation + owner), and activeCall must still be this same call.
      // Anything less means a newer attempt (possibly the other owner) or
      // a reset/identity switch has already superseded this reconciliation.
      const isValid = () => {
        const held = lifecycleActionInFlightRef.current;
        const current = activeCallRef.current;
        return (
          !!held &&
          held.callId === marker.callId &&
          held.requestId === marker.requestId &&
          held.generation === marker.generation &&
          held.owner === marker.owner &&
          !!current &&
          current.call.id === callId
        );
      };

      const token = accessTokenRef.current;
      if (!token) return;
      if (!isValid()) return; // superseded before we even started

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
        // Double failure: the lifecycle request AND this reconciliation read
        // both failed — still no network, still no idea what the server
        // thinks. Re-validate full ownership first: if a reset, an identity
        // switch, or a newer attempt (from either owner) already superseded
        // this marker while the GET was failing, this response must not
        // produce any UI/toast/state side effect at all.
        if (!isValid()) return;
        // Do not assume the call ended, and do not strand the UI in a
        // transitional phase like 'ending' that the poll loop below does
        // not cover (it only polls while phase is one of
        // outgoingRinging/incomingRinging/connecting/connected/reconnecting)
        // — that would silently stop all further reconciliation attempts.
        // Restore a phase the poll loop does cover, based on the call's
        // last known (pre-action) status, so GET /:callId keeps being
        // retried automatically.
        const current = activeCallRef.current;
        if (current && current.call.id === callId) {
          if (current.call.status === 'RINGING') {
            setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
          } else if (current.call.status === 'ACCEPTED') {
            // Restore the media phase from before this action, not a blind
            // 'connecting' — if media was already connected/reconnecting
            // (or was, before the action optimistically left it), that must
            // not regress, and existing livekit credentials are untouched
            // since activeCall itself is never modified here.
            setPhase(prev => {
              if (prev === 'connected' || prev === 'reconnecting') return prev;
              if (previousPhase === 'connected' || previousPhase === 'reconnecting' || previousPhase === 'connecting') {
                return previousPhase;
              }
              return 'connecting';
            });
          }
        }
        showToast('Connection issue — retrying…', 'error');
        return;
      }

      // Re-validate full ownership after the await, before touching
      // applyTerminalOutcome/setActiveCall/setPhase/ensureLiveKitToken at
      // all — a newer attempt (either owner), a reset, or an identity
      // switch (the ABA case: this exact callId recovered again under a
      // brand-new session) may have superseded this marker while the GET
      // was in flight. A stale response must never overwrite whatever the
      // current session has already established.
      if (!isValid()) return;
      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) return;

      if (TERMINAL_STATUSES.has(call.status)) {
        applyTerminalOutcome(call, current.role);
        return;
      }

      if (call.status === 'RINGING') {
        // The action never actually landed — restore the ringing UI (with
        // cancel/decline still available) so the user can retry, instead of
        // silently vanishing while the other side is still ringing/waiting.
        setActiveCall({ call, livekit: null, role: current.role, isCallKitManaged: current.isCallKitManaged });
        setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
        return;
      }

      if (call.status === 'ACCEPTED') {
        // The call is actually still live — restore whichever of
        // connecting/connected/reconnecting matches the current media
        // state instead of the phase this action was trying to leave.
        // Existing LiveKit credentials must not be dropped.
        setActiveCall({ call, livekit: current.livekit, role: current.role, isCallKitManaged: current.isCallKitManaged });
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!current.livekit) ensureLiveKitToken(call, current.role);
      }
    },
    [applyTerminalOutcome, ensureLiveKitToken]
  );

  // Shared decline/cancel/end runner. The Call row is the only source of
  // truth: a 200 response is verified against the expected terminal status
  // before being trusted, and any failure (network error, timeout, 409, or a
  // dropped response) is reconciled against the server instead of assuming
  // the action succeeded, failed, or that the call is simply gone.
  //
  // Shares lifecycleActionInFlightRef with attemptMediaFailureReport — both
  // mint their own LifecycleActionMarker (owner-tagged) when acquiring the
  // lock, so a stale marker from a previous identity/session can never
  // block a genuinely new attempt (busy is only true when callId *and*
  // generation both match), and `finally` only ever releases the lock if it
  // still holds exactly this marker.
  const runLifecycleAction = useCallback(
    async (
      apiCall: (token: string, callId: string) => Promise<CallSummary>,
      expectedStatus: CallSummary['status'],
      previousPhase?: CallPhase
    ) => {
      const token = accessTokenRef.current;
      const current = activeCallRef.current;
      if (!token || !current) return;

      const callId = current.call.id;
      const generation = recoveryGenerationRef.current;
      const existing = lifecycleActionInFlightRef.current;
      if (existing && existing.callId === callId && existing.generation === generation) return;

      const requestId = ++nextLifecycleActionRequestIdRef.current;
      const marker: LifecycleActionMarker = { callId, requestId, generation, owner: 'lifecycle' };
      lifecycleActionInFlightRef.current = marker;

      const stillHoldsMarker = () => {
        const held = lifecycleActionInFlightRef.current;
        return (
          !!held &&
          held.callId === marker.callId &&
          held.requestId === marker.requestId &&
          held.generation === marker.generation &&
          held.owner === marker.owner
        );
      };

      try {
        const result = await apiCall(token, callId);

        // Late-response guard: don't overwrite state that already moved on
        // while this request was in flight — a different call, a different
        // identity generation (the ABA case: this same callId recovered
        // again under a new session), or a newer attempt having already
        // taken over the shared lock.
        const latest = activeCallRef.current;
        if (
          !latest ||
          latest.call.id !== callId ||
          recoveryGenerationRef.current !== generation ||
          !stillHoldsMarker()
        ) {
          return;
        }

        if (result.status === expectedStatus) {
          applyTerminalOutcome(result, latest.role);
        } else {
          // Defensive: a 200 that doesn't actually carry the expected
          // terminal status must not be blindly trusted — reconcile against
          // the server's real status instead of assuming success.
          await reconcileLifecycleAction(marker, previousPhase);
        }
      } catch {
        // Same identity/marker validation before reconciling — a
        // superseded request must not reconcile against whatever this
        // callId now represents under a different session.
        if (recoveryGenerationRef.current !== generation || !stillHoldsMarker()) return;
        await reconcileLifecycleAction(marker, previousPhase);
      } finally {
        // Only clear the shared lock if it's still exactly the marker this
        // call created — a newer request (a different requestId/generation,
        // possibly held by attemptMediaFailureReport instead) must never
        // have its lock cleared by this one settling late.
        if (stillHoldsMarker()) {
          lifecycleActionInFlightRef.current = null;
        }
      }
    },
    [applyTerminalOutcome, reconcileLifecycleAction]
  );

  const declineCallAction = useCallback(
    () => runLifecycleAction(declineCallApi, 'DECLINED'),
    [runLifecycleAction]
  );

  const cancelCallAction = useCallback(
    () => runLifecycleAction(cancelCallApi, 'CANCELED'),
    [runLifecycleAction]
  );

  const endCallAction = useCallback(async () => {
    if (!activeCallRef.current) return;
    // Save the media phase from before this optimistic 'ending' transition.
    // If both the end request and the GET reconciliation fail, this is what
    // lets reconcileLifecycleAction restore connecting/connected/reconnecting
    // instead of leaving phase stuck at 'ending', which the poll effect
    // below does not cover and would never retry on its own.
    const previousPhase = phaseRef.current;
    setPhase('ending');
    await runLifecycleAction(endCallApi, 'ENDED', previousPhase);
  }, [runLifecycleAction]);

  const reportMediaConnected = useCallback(() => {
    setPhase(prev => (prev === 'connecting' || prev === 'reconnecting' ? 'connected' : prev));
    // A confirmed reconnect invalidates any outstanding "is media really
    // gone" confirmation attempt — whatever disconnect/watchdog/grace-timer
    // signal triggered it no longer reflects reality. This does NOT touch
    // pendingMediaFailureRef: once a failure has actually been decided and
    // reporting has started, a coincidental reconnect must not cancel it —
    // only the server's own status does that.
    pendingConfirmationRef.current = null;
    if (confirmRetryTimerRef.current) {
      clearTimeout(confirmRetryTimerRef.current);
      confirmRetryTimerRef.current = null;
    }
  }, []);

  const reportMediaDisconnected = useCallback(() => {
    setPhase(prev => (prev === 'connected' ? 'reconnecting' : prev));
  }, []);

  const scheduleMediaFailureRetry = useCallback((callId: string) => {
    if (mediaFailureRetryTimerRef.current) return; // one retry outstanding at a time — no storm
    mediaFailureRetryTimerRef.current = setTimeout(() => {
      mediaFailureRetryTimerRef.current = null;
      // Re-derive the reason from the live pending ref rather than closing
      // over a value captured when this retry was scheduled — if a newer
      // reason was saved for this same call in the meantime (reportMediaFailure
      // called again before this timer fired), the retry must use that
      // newer reason, never an overwritten stale one.
      attemptMediaFailureReportRef.current(callId);
    }, MEDIA_FAILURE_RETRY_MS);
  }, []);

  // Reconciles a failed POST /fail via GET /:callId, same shape as
  // reconcileLifecycleAction but specific to the fail-report flow: on top of
  // restoring a pollable phase, it re-schedules the fail report itself
  // (reconcileLifecycleAction has no notion of "retry the action that
  // failed" — decline/cancel/end don't need it, since the ordinary poll
  // loop's refreshCall is sufficient reconciliation for those).
  //
  // `marker` is the exact LifecycleActionMarker attemptMediaFailureReport
  // minted for the POST /fail this is reconciling. Every stage below
  // re-validates, in order: pendingMediaFailureRef still belongs to this
  // call, the identity/recovery generation hasn't moved on, this marker is
  // still the one holding the shared lock (not superseded by a newer
  // attempt from either owner), and activeCall is still the same call. Any
  // failure of these checks means a stale response — it must not clear
  // pending, touch phase/activeCall, call applyTerminalOutcome, or schedule
  // a retry.
  const reconcileMediaFailure = useCallback(
    async (marker: LifecycleActionMarker, previousPhase?: CallPhase) => {
      const { callId, generation } = marker;
      const isValid = () => {
        const pending = pendingMediaFailureRef.current;
        const held = lifecycleActionInFlightRef.current;
        const current = activeCallRef.current;
        return (
          !!pending &&
          pending.callId === callId &&
          recoveryGenerationRef.current === generation &&
          !!held &&
          held.callId === marker.callId &&
          held.requestId === marker.requestId &&
          held.generation === marker.generation &&
          held.owner === marker.owner &&
          !!current &&
          current.call.id === callId
        );
      };

      if (!isValid()) return;

      const token = accessTokenRef.current;
      if (!token) {
        scheduleMediaFailureRetry(callId);
        return;
      }

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
        // Double failure: the POST /fail AND this reconciliation GET both
        // failed. Re-validate before doing anything — if reset, an identity
        // switch, or a newer request already superseded this marker while
        // the GET was failing, discard silently: no pending mutation, no
        // phase change, no retry scheduling.
        if (!isValid()) return;
        // The pending failure must not be dropped — schedule an automatic
        // retry instead of relying on the ambient poll loop (which only
        // refreshes state, it never retries reporting a failure). Also keep
        // the UI on a phase the poll loop covers so GET /:callId itself
        // keeps being retried in the meantime.
        const current = activeCallRef.current;
        if (current && current.call.id === callId) {
          if (current.call.status === 'RINGING') {
            setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
          } else if (current.call.status === 'ACCEPTED') {
            setPhase(prev => {
              if (prev === 'connected' || prev === 'reconnecting') return prev;
              if (previousPhase === 'connected' || previousPhase === 'reconnecting' || previousPhase === 'connecting') {
                return previousPhase;
              }
              return 'connecting';
            });
          }
        }
        showToast('Connection issue — will retry…', 'error');
        scheduleMediaFailureRetry(callId);
        return;
      }

      // Re-validate after the await before acting on the response at all —
      // reset/identity-switch/a newer request could have superseded this
      // marker while the GET was in flight. isValid() already requires
      // activeCall to still be this exact callId, so the branch below is
      // unreachable in practice — kept as a no-op defensive guard only:
      // it must never clear pendingMediaFailureRef itself, since that
      // would let a stale reconciliation erase a newer, already-updated
      // pending state for whatever the call/identity has since become.
      if (!isValid()) return;

      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) return;

      if (TERMINAL_STATUSES.has(call.status)) {
        // The server already has a terminal outcome (possibly FAILED from
        // a previous retry attempt that this client never heard back from,
        // or some other terminal status) — adopt it and stop retrying.
        pendingMediaFailureRef.current = null;
        if (mediaFailureRetryTimerRef.current) {
          clearTimeout(mediaFailureRetryTimerRef.current);
          mediaFailureRetryTimerRef.current = null;
        }
        applyTerminalOutcome(call, current.role);
        return;
      }

      if (call.status === 'RINGING') {
        setActiveCall({ call, livekit: null, role: current.role, isCallKitManaged: current.isCallKitManaged });
        setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
      } else if (call.status === 'ACCEPTED') {
        setActiveCall({ call, livekit: current.livekit, role: current.role, isCallKitManaged: current.isCallKitManaged });
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!current.livekit) ensureLiveKitToken(call, current.role);
      }

      // The GET itself succeeded but the call is still RINGING/ACCEPTED —
      // the original POST /fail didn't land. Retry it rather than silently
      // dropping the failure report.
      scheduleMediaFailureRetry(callId);
    },
    [applyTerminalOutcome, ensureLiveKitToken, scheduleMediaFailureRetry]
  );

  // Reports a local media/connection failure. `callId` is the only
  // parameter — the reason is always re-read from pendingMediaFailureRef at
  // the point of use, never trusted from a stale closure, so a newer reason
  // saved for the same call always wins.
  //
  // Acquires the shared lifecycleActionInFlightRef lock (see
  // runLifecycleAction) by minting its own owner-tagged marker — busy is
  // only true when the held marker's callId *and* generation both match,
  // so a stale marker from a previous identity/session never blocks a
  // genuinely new attempt. Critically, if the shared slot is busy (held by
  // either a decline/cancel/end action or another media-failure attempt
  // for this same call+generation) this does NOT just drop the attempt —
  // the failure intent is real and must survive, so it reschedules at the
  // standard interval instead.
  const attemptMediaFailureReport = useCallback(
    async (callId: string) => {
      const pending = pendingMediaFailureRef.current;
      if (!pending || pending.callId !== callId) return; // superseded or already resolved

      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) {
        pendingMediaFailureRef.current = null; // no longer the active call — stop retrying
        return;
      }

      const generation = recoveryGenerationRef.current;
      const existing = lifecycleActionInFlightRef.current;
      // Only treat the shared slot as busy if it belongs to this exact call
      // *and* identity generation — a stale marker from a previous identity
      // (or an earlier session of the same user, pre-ABA round trip) must
      // never block a genuinely new attempt, regardless of which owner
      // holds it.
      if (existing && existing.callId === callId && existing.generation === generation) {
        scheduleMediaFailureRetry(callId);
        return;
      }

      const token = accessTokenRef.current;
      if (!token) {
        scheduleMediaFailureRetry(callId);
        return;
      }

      const requestId = ++nextLifecycleActionRequestIdRef.current;
      const marker: LifecycleActionMarker = { callId, requestId, generation, owner: 'mediaFailure' };
      lifecycleActionInFlightRef.current = marker;
      const reason = pending.reason;
      const previousPhase = phaseRef.current;

      const stillHoldsMarker = () => {
        const held = lifecycleActionInFlightRef.current;
        return (
          !!held &&
          held.callId === marker.callId &&
          held.requestId === marker.requestId &&
          held.generation === marker.generation &&
          held.owner === marker.owner
        );
      };

      try {
        const result = await failCallApi(token, callId, reason);

        // Re-validate everything before acting: the pending entry might
        // have been cleared/superseded, activeCall might have moved on, the
        // identity generation might have changed, or (identity/ABA-safe) a
        // newer attempt might have already taken over the shared lock while
        // the POST was in flight.
        const stillPending = pendingMediaFailureRef.current;
        const latest = activeCallRef.current;
        if (
          !stillPending ||
          stillPending.callId !== callId ||
          recoveryGenerationRef.current !== generation ||
          !latest ||
          latest.call.id !== callId ||
          !stillHoldsMarker()
        ) {
          return;
        }

        if (result.status === 'FAILED') {
          pendingMediaFailureRef.current = null;
          if (mediaFailureRetryTimerRef.current) {
            clearTimeout(mediaFailureRetryTimerRef.current);
            mediaFailureRetryTimerRef.current = null;
          }
          applyTerminalOutcome(result, latest.role);
        } else {
          // Defensive: a 200 that isn't actually FAILED must not be trusted
          // blindly — reconcile (and retry if needed) against the server's
          // real status.
          await reconcileMediaFailure(marker, previousPhase);
        }
      } catch {
        // Validate the marker/generation BEFORE reconciling — a superseded
        // attempt (reset, identity switch, or a newer attempt from either
        // owner) must not fall into reconciliation at all.
        if (recoveryGenerationRef.current !== generation || !stillHoldsMarker()) return;
        await reconcileMediaFailure(marker, previousPhase);
      } finally {
        // Only clear the shared lock if it's still exactly the marker this
        // call created — a newer attempt (different requestId/generation,
        // possibly held by runLifecycleAction instead) must never have its
        // lock cleared by this one settling late.
        if (stillHoldsMarker()) {
          lifecycleActionInFlightRef.current = null;
        }
      }
    },
    [applyTerminalOutcome, reconcileMediaFailure, scheduleMediaFailureRetry]
  );
  attemptMediaFailureReportRef.current = attemptMediaFailureReport;

  const reportMediaFailure = useCallback(
    async (reason: CallFailureReason) => {
      const current = activeCallRef.current;
      if (!current) return;

      const callId = current.call.id;
      // Persist immediately — this is an already-decided real local
      // failure; it must survive even if the network is down right now for
      // both the POST and any reconciliation GET that follows. Overwrites
      // any previously-pending reason for the same call — attemptMediaFailureReport
      // always re-reads this ref fresh, so the newest reason always wins.
      pendingMediaFailureRef.current = { callId, reason };

      await attemptMediaFailureReport(callId);
    },
    [attemptMediaFailureReport]
  );

  const scheduleConfirmRetry = useCallback((callId: string, requestId: number, generation: number) => {
    if (confirmRetryTimerRef.current) return; // one retry outstanding at a time
    confirmRetryTimerRef.current = setTimeout(() => {
      confirmRetryTimerRef.current = null;
      attemptConfirmCallOrFailRef.current(callId, requestId, generation);
    }, CONFIRM_RETRY_MS);
  }, []);

  // GET /:callId first, act on the server's real status second. Only ever
  // escalates to FAILED when the server still says ACCEPTED — a peer who
  // ended the call normally (ENDED) or any other terminal outcome already
  // observed server-side is adopted as-is, never overwritten. If the GET
  // itself fails, the confirmation is not dropped — it's retried
  // automatically (see scheduleConfirmRetry) instead of leaving the call
  // stuck in connecting/reconnecting with nothing left to re-check it.
  //
  // `requestId`/`generation` (together with `callId`) identify exactly which
  // confirmation attempt this is. Every await below re-checks pendingConfirmationRef
  // against this exact triple before acting — if reportMediaConnected (media
  // recovered), resetToIdle (call/identity gone), or a newer confirmCallOrFail
  // call already superseded it, a late GET response is discarded outright
  // and never turns into a POST /fail.
  const attemptConfirmCallOrFail = useCallback(
    async (callId: string, requestId: number, generation: number) => {
      const isCurrentAttempt = () => {
        const marker = pendingConfirmationRef.current;
        return (
          !!marker &&
          marker.callId === callId &&
          marker.requestId === requestId &&
          marker.generation === generation
        );
      };

      if (!isCurrentAttempt()) return; // superseded or already resolved before we even started

      const current = activeCallRef.current;
      if (!current || current.call.id !== callId) {
        pendingConfirmationRef.current = null;
        return;
      }
      if (current.call.status !== 'ACCEPTED') {
        // Something else already resolved this call (e.g. a lifecycle
        // action's own reconciliation, or media reconnected) — nothing left
        // to confirm.
        pendingConfirmationRef.current = null;
        return;
      }

      const token = accessTokenRef.current;
      if (!token) {
        scheduleConfirmRetry(callId, requestId, generation);
        return;
      }

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
        // Can't confirm anything right now. Do not drop this — schedule an
        // automatic retry so the call doesn't stay stuck in
        // connecting/reconnecting once the network recovers. Re-check
        // first: media may have reconnected (reportMediaConnected already
        // cleared the marker) while this GET was failing.
        if (!isCurrentAttempt()) return;
        scheduleConfirmRetry(callId, requestId, generation);
        return;
      }

      // Re-validate after the await: media may have reconnected
      // (reportMediaConnected clears pendingConfirmationRef), a newer
      // confirmCallOrFail call may have started a fresh attempt, or
      // resetToIdle/identity switch may have invalidated this one entirely.
      // A late response failing this check is discarded — it must never
      // result in a POST /fail for a call whose confirmation is no longer
      // wanted.
      if (!isCurrentAttempt()) return;

      const latest = activeCallRef.current;
      if (!latest || latest.call.id !== callId) {
        pendingConfirmationRef.current = null;
        return;
      }

      if (TERMINAL_STATUSES.has(call.status)) {
        pendingConfirmationRef.current = null;
        if (confirmRetryTimerRef.current) {
          clearTimeout(confirmRetryTimerRef.current);
          confirmRetryTimerRef.current = null;
        }
        applyTerminalOutcome(call, latest.role);
        return;
      }

      if (call.status === 'ACCEPTED') {
        pendingConfirmationRef.current = null;
        if (confirmRetryTimerRef.current) {
          clearTimeout(confirmRetryTimerRef.current);
          confirmRetryTimerRef.current = null;
        }
        await reportMediaFailure('LIVEKIT_CONNECTION_FAILED');
      }
    },
    [applyTerminalOutcome, reportMediaFailure, scheduleConfirmRetry]
  );
  attemptConfirmCallOrFailRef.current = attemptConfirmCallOrFail;

  const confirmCallOrFail = useCallback(async () => {
    const current = activeCallRef.current;
    // Nothing to confirm: no active call, or it's not supposed to be live
    // right now anyway (already terminal via some other path).
    if (!current || current.call.status !== 'ACCEPTED') return;

    const callId = current.call.id;
    // Coalesce with an already-pending/in-flight confirmation for this same
    // call (e.g. the watchdog timeout and onDisconnected firing moments
    // apart) rather than spawning a second parallel GET — the existing
    // attempt (or its scheduled retry) already covers it.
    if (pendingConfirmationRef.current?.callId === callId) return;

    const generation = recoveryGenerationRef.current;
    const requestId = ++nextConfirmRequestIdRef.current;
    pendingConfirmationRef.current = { callId, requestId, generation };
    await attemptConfirmCallOrFail(callId, requestId, generation);
  }, [attemptConfirmCallOrFail]);

  // ---------------------------------------------------------------------------
  // CallKit audio-session activation forwarding + private-call audio
  // authorization (Gate requirement — see lib/callAudioCoordinator.ts for the
  // full design rationale). No callId of their own; they just poke the
  // CallKit-audio state machine, which is the only thing that carries
  // call-scoped meaning (via managedCallId/generation).
  // ---------------------------------------------------------------------------

  const handleNativeAudioSessionActivated = useCallback(() => {
    setCallKitAudioState(prev => resolveCallKitAudioActivation(prev));
  }, []);

  const handleNativeAudioSessionDeactivated = useCallback(() => {
    setCallKitAudioState(prev => resolveCallKitAudioDeactivation(prev));
  }, []);

  // Whether components/voice-call-modal.tsx may let LiveKitRoom actually
  // connect right now. Always true once there's no activeCall at all (no
  // call to gate) or the active call never went through CallKit.
  const isPrivateCallAudioAuthorized = activeCall
    ? resolveIsPrivateCallAudioAuthorized({
        isCallKitManaged: activeCall.isCallKitManaged,
        callKitAudio: callKitAudioState,
        callId: activeCall.call.id,
      })
    : true;

  // ---------------------------------------------------------------------------
  // App-Accept -> CallKit answerIncomingCall sync (Gate requirement, section
  // three) — the plain UI "Accept" button's own entry point (exposed as
  // `acceptCall` below), NOT handleNativeAnswer (which calls acceptCallAction
  // directly, unwrapped) — that asymmetry alone is what prevents a
  // CallKit-originated answer from ever echoing back into
  // answerIncomingCall; see lib/callAudioCoordinator.ts's
  // shouldSyncAnswerIncomingCall doc comment.
  // ---------------------------------------------------------------------------

  const acceptCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) return;

    const callId = current.call.id;
    const generation = recoveryGenerationRef.current;
    const capturedAuthUserId = authUserIdRef.current;
    // isCallKitManaged is a local, device-only flag — GET /calls/:callId
    // never returns it, so (unlike call.status below) it cannot be
    // re-confirmed against the server. Captured here, BEFORE any await,
    // rather than read from activeCallRef.current afterward: activeCallRef
    // only re-syncs to a fresh value on CallProvider's NEXT render (see its
    // per-render `activeCallRef.current = activeCall` assignment), which is
    // not guaranteed to have committed yet immediately after an awaited
    // Promise resolves — reading it post-await here would risk seeing a
    // stale isCallKitManaged (or stale call.status) rather than this exact
    // call's real state.
    const wasCallKitManaged = current.isCallKitManaged;

    const identityStillValid = () =>
      recoveryGenerationRef.current === generation && authUserIdRef.current === capturedAuthUserId;

    // acceptCallAction already handles dedup/late-response/reconciliation in
    // full (see its own extensive comments) — this wrapper only adds a
    // best-effort CallKit sync AFTER it settles, never changing its own
    // accept/reconcile behavior, and never trusting acceptCallAction's own
    // internal state writes as proof of the server's real status.
    await acceptCallAction();
    if (!identityStillValid()) return;

    const token = accessTokenRef.current;
    if (!token) return;

    // The authoritative confirmation this sync needs: not activeCallRef
    // (which may not reflect acceptCallAction's outcome yet), but a fresh,
    // independent GET — the same "REST is the only source of truth" rule
    // every other native/App entry point in this file already follows.
    let call: CallSummary;
    try {
      call = await getCallApi(token, callId);
    } catch {
      return; // GET failed — never sync on an unconfirmed status; nothing else to clean up
    }
    if (!identityStillValid()) return;

    const decision = shouldSyncAnswerIncomingCall({
      alreadySyncedCallId: answerIncomingCallSyncedForRef.current,
      targetCallId: callId,
      isIdentityStillValid: identityStillValid(),
      isCallKitManaged: wasCallKitManaged,
      callStatus: call.status,
    });
    if (!decision) return;

    // Mark synced BEFORE the (fire-and-forget) native call — "at most once"
    // even if answerIncomingCallKitCall itself is slow, and a failure inside
    // it (swallowed internally — see lib/voipPushKit.ts) can never roll this
    // back or touch phase/activeCall, so it can never turn an already-
    // server-confirmed ACCEPTED call into a failure.
    answerIncomingCallSyncedForRef.current = callId;
    void answerIncomingCallKitCall(callId);
  }, [acceptCallAction]);

  // ---------------------------------------------------------------------------
  // Native intent entry points (iOS PushKit/CallKit coordinator) — see
  // docs/private-voice-calling-spec.md "iOS 原生能力". GET /calls/:callId is
  // the only source of truth for what a native payload/event *means*; none
  // of these ever act on callerName/handle/role/status carried by the
  // native side. Each re-validates against the server and then delegates
  // into the existing action functions above rather than duplicating any
  // state-machine logic, so all of their generation/identity/late-response
  // protections apply for free.
  // ---------------------------------------------------------------------------

  const handleNativeIncoming = useCallback(
    async (callId: string): Promise<NativeCallIntentResult> => {
      if (!isValidCallId(callId)) return 'discarded';

      // Captured before the only await below and re-checked immediately
      // after it, before any React state or native CallKit side effect —
      // same identity guard as handleNativeAnswer/handleNativeEnd (see
      // captureNativeIntentSession/isNativeIntentSessionStillValid above).
      const session = captureNativeIntentSession();
      const token = accessTokenRef.current;
      const userId = session.dbUserId;
      if (!token || !userId) return 'retry';

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch (error) {
        if (!isNativeIntentSessionStillValid(session)) return 'discarded'; // identity switched — no stale-identity CallKit side effect
        if (error instanceof ApiError && error.status === 404) {
          // Non-participant or nonexistent call — never surface it, and
          // make sure CallKit doesn't keep showing anything for it. The
          // coordinator's enqueue-time handleNativeCallKitCallIdSeen already
          // started tracking this callId for the audio-session gate before
          // this REST validation even began — a definitive 404 means it
          // must be cleared, never left dangling.
          endNativeCallKitCall(callId, 'remoteEnded');
          clearCallKitTrackingIfMatches(callId);
          return 'discarded';
        }
        return 'retry'; // transient network error — the coordinator's pending queue retries; keep the audio tracking, this call may still be confirmed
      }
      if (!isNativeIntentSessionStillValid(session)) {
        clearCallKitTrackingIfMatches(callId); // identity switched while this GET was in flight
        return 'discarded';
      }

      if (call.caller.id !== userId && call.callee.id !== userId) {
        // Should be unreachable (the backend itself 404s non-participants)
        // — fail safe rather than ever act on a call this identity isn't
        // part of.
        endNativeCallKitCall(callId, 'remoteEnded');
        clearCallKitTrackingIfMatches(callId);
        return 'discarded';
      }

      if (TERMINAL_STATUSES.has(call.status)) {
        // Do not resurrect app call UI for a call that's already over —
        // just make sure CallKit's own UI (if still showing anything)
        // closes. Not routed through applyTerminalOutcome/suppression:
        // CallKit does not yet know this call is dead (it's mid-displaying
        // an incoming call), so this is a genuine first notification, not
        // a redundant one.
        endNativeCallKitCall(
          callId,
          call.status === 'FAILED' ? 'failed' : call.status === 'MISSED' ? 'unanswered' : 'remoteEnded'
        );
        clearCallKitTrackingIfMatches(callId);
        return 'discarded';
      }

      // This intent came from the coordinator's native CallKit path
      // (didDisplayIncomingCall/its didLoadWithEvents replay, or the
      // 'notification' PushKit event — either way, CallKit is/was displaying
      // this callId) — start (or continue) tracking it for the private-call
      // audio-session gate (idempotent/redundant with the coordinator's own
      // enqueue-time handleNativeCallKitCallIdSeen call above, which is what
      // lets a didActivateAudioSession arriving before this REST GET
      // completes still land on the right callId), and retroactively mark
      // an already-locally-established record (e.g. from recoverActiveCall)
      // as CallKit-managed.
      markCallKitManaged(callId);

      const current = activeCallRef.current;
      if (current) {
        // Already established locally (e.g. a duplicate notification +
        // didDisplayIncomingCall pair for the same call, or Realtime beat
        // this intent to it) — idempotent no-op. A DIFFERENT call already
        // active locally must never be clobbered by this one.
        if (current.call.id !== callId) {
          clearCallKitTrackingIfMatches(callId);
          return 'discarded';
        }
        return 'handled';
      }

      // Resolve the *real* role from the server rather than assuming
      // "incoming => I'm the callee" — a caller's own device receiving a
      // spurious/misrouted incoming CallKit event must be reconciled
      // against the true status/role, not shown as if it were incoming.
      const role: 'caller' | 'callee' = call.caller.id === userId ? 'caller' : 'callee';

      if (call.status === 'RINGING') {
        setActiveCall({ call, livekit: null, role, isCallKitManaged: true });
        setPhase(role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
        return 'handled';
      }

      if (call.status === 'ACCEPTED') {
        setActiveCall({ call, livekit: null, role, isCallKitManaged: true });
        setPhase('connecting');
        ensureLiveKitToken(call, role);
        return 'handled';
      }

      return 'handled';
    },
    [captureNativeIntentSession, isNativeIntentSessionStillValid, ensureLiveKitToken, markCallKitManaged, clearCallKitTrackingIfMatches]
  );

  const handleNativeAnswer = useCallback(
    async (callId: string): Promise<NativeCallIntentResult> => {
      if (!isValidCallId(callId)) return 'discarded';

      // Captured before any await — every check below re-validates against
      // it, so a login/logout/switch (authUserId/recoveryGenerationRef
      // changing) that happens while this handler is mid-flight can never
      // let a stale response write back into the new session (see
      // runLifecycleAction's identical pattern above and
      // captureNativeIntentSession/isNativeIntentSessionStillValid).
      const session = captureNativeIntentSession();
      const token = accessTokenRef.current;
      const userId = session.dbUserId;
      if (!token || !userId) return 'retry'; // coordinator queues this until auth is restored

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch (error) {
        if (!isNativeIntentSessionStillValid(session)) return 'discarded'; // identity switched — no stale-identity CallKit side effect
        if (error instanceof ApiError && error.status === 404) {
          endNativeCallKitCall(callId, 'remoteEnded');
          clearCallKitTrackingIfMatches(callId);
          return 'discarded';
        }
        return 'retry'; // transient network error — keep the audio tracking, this call may still be confirmed
      }
      if (!isNativeIntentSessionStillValid(session)) {
        clearCallKitTrackingIfMatches(callId); // identity switched while this GET was in flight
        return 'discarded';
      }

      if (call.callee.id !== userId) {
        // Not this identity's call to answer (e.g. this device is the
        // caller, or a non-participant) — close whatever CallKit is
        // showing and give up.
        endNativeCallKitCall(callId, 'remoteEnded');
        clearCallKitTrackingIfMatches(callId);
        return 'discarded';
      }

      if (TERMINAL_STATUSES.has(call.status)) {
        // Already over server-side — never call accept. Just close out
        // native UI (app UI was never opened for this by this handler).
        endNativeCallKitCall(
          callId,
          call.status === 'FAILED' ? 'failed' : call.status === 'MISSED' ? 'unanswered' : 'remoteEnded'
        );
        clearCallKitTrackingIfMatches(callId);
        return 'discarded';
      }

      // A different call already active locally (should be unreachable —
      // the backend enforces one active RINGING/ACCEPTED call per user —
      // but never risk clobbering it or wrong-acting on it if it somehow
      // happens).
      const existingActive = activeCallRef.current;
      if (existingActive && existingActive.call.id !== callId) {
        clearCallKitTrackingIfMatches(callId);
        return 'discarded';
      }

      // CallKit's own answer action for this callId just fired — start (or
      // continue) tracking it for the private-call audio-session gate. See
      // handleNativeIncoming's identical call for why this also retroactively
      // patches an already-established local record.
      markCallKitManaged(callId);

      if (call.status === 'ACCEPTED') {
        // Idempotent success — already answered (e.g. a duplicate
        // answerCall replay via didLoadWithEvents, or Realtime/poll beat
        // this intent to accepting). Adopt ACCEPTED and make sure LiveKit
        // credentials get fetched, without calling accept again.
        const existingLivekit = existingActive?.call.id === callId ? existingActive.livekit : null;
        const nextActiveCall: ActiveCall = { call, livekit: existingLivekit, role: 'callee', isCallKitManaged: true };
        activeCallRef.current = nextActiveCall;
        setActiveCall(nextActiveCall);
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!existingLivekit) ensureLiveKitToken(call, 'callee');
        return 'handled';
      }

      if (call.status !== 'RINGING') {
        clearCallKitTrackingIfMatches(callId);
        return 'discarded'; // unexpected status — nothing sensible to do
      }

      // Establish activeCallRef SYNCHRONOUSLY (a direct ref assignment, not
      // only setActiveCall — which only takes effect on the next render)
      // before delegating to acceptCallAction, whose very first line reads
      // activeCallRef.current. Without this, acceptCallAction could read a
      // stale/unrelated ref value and silently no-op instead of accepting
      // — the "ref/internal helper convergence" this phase-3 task requires
      // instead of guessing timing with setTimeout.
      const nextActiveCall: ActiveCall = { call, livekit: null, role: 'callee', isCallKitManaged: true };
      activeCallRef.current = nextActiveCall;
      setActiveCall(nextActiveCall);

      // acceptCallAction itself already handles the "POST /accept fails"
      // case via reconcileAfterAcceptFailure's GET-based reconciliation —
      // reused here as-is. It never throws and never tells us definitively
      // whether the server actually transitioned to ACCEPTED, though — it
      // only restores sensible local UI on failure. Do not report 'handled'
      // just because this Promise resolved: confirm with our own
      // authoritative read afterward.
      await acceptCallAction();
      if (!isNativeIntentSessionStillValid(session)) return 'discarded';

      let confirmed: CallSummary | null = null;
      let outcome: NativeCallIntentResult;
      try {
        confirmed = await getCallApi(token, callId);
        outcome = resolveAnswerConfirmation({
          networkError: false,
          serverConfirmsAccepted: confirmed.status === 'ACCEPTED',
          serverIsTerminal: TERMINAL_STATUSES.has(confirmed.status),
        });
      } catch {
        // Still no network — the coordinator retries; a re-run safely
        // re-POSTs accept if the call turns out to still be RINGING.
        outcome = resolveAnswerConfirmation({ networkError: true });
      }
      if (!isNativeIntentSessionStillValid(session)) return 'discarded';

      if (outcome === 'handled' && confirmed && confirmed.status !== 'ACCEPTED') {
        // The accept genuinely never landed and the call ended some other
        // way in the same window (e.g. the caller canceled) — make sure
        // local state reflects it if the internal reconcile path hasn't
        // already caught up.
        const current = activeCallRef.current;
        if (current?.call.id === callId && !TERMINAL_STATUSES.has(current.call.status)) {
          applyTerminalOutcome(confirmed, 'callee');
        }
      }

      return outcome;
    },
    [captureNativeIntentSession, isNativeIntentSessionStillValid, acceptCallAction, applyTerminalOutcome, ensureLiveKitToken, markCallKitManaged, clearCallKitTrackingIfMatches]
  );

  const handleNativeEnd = useCallback(
    async (callId: string): Promise<NativeCallIntentResult> => {
      if (!isValidCallId(callId)) return 'discarded';

      // See handleNativeAnswer's identical comment above — captured before
      // any await, re-checked after every one (authUserId + generation +
      // dbUserId), so a late response can never write back into a session
      // that has since switched.
      const session = captureNativeIntentSession();
      const token = accessTokenRef.current;
      const userId = session.dbUserId;
      if (!token || !userId) return 'retry';

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch (error) {
        if (!isNativeIntentSessionStillValid(session)) return 'discarded'; // identity switched — no stale-identity CallKit side effect
        if (error instanceof ApiError && error.status === 404) {
          endNativeCallKitCall(callId, 'remoteEnded');
          return 'discarded';
        }
        return 'retry'; // network failure — coordinator retries; never resetToIdle directly
      }
      if (!isNativeIntentSessionStillValid(session)) return 'discarded';

      if (call.caller.id !== userId && call.callee.id !== userId) {
        endNativeCallKitCall(callId, 'remoteEnded');
        return 'discarded';
      }

      if (TERMINAL_STATUSES.has(call.status)) {
        // Already over server-side — idempotent. Clean up whichever of
        // native/app UI is still showing this call, without invoking
        // decline/cancel/end again.
        if (activeCallRef.current?.call.id === callId) {
          suppressNativeEndSync(callId); // this path already leads into applyTerminalOutcome below
          applyTerminalOutcome(call, call.caller.id === userId ? 'caller' : 'callee');
        } else {
          endNativeCallKitCall(
            callId,
            call.status === 'FAILED' ? 'failed' : call.status === 'MISSED' ? 'unanswered' : 'remoteEnded'
          );
        }
        return 'handled';
      }

      // A different call already active locally (should be unreachable —
      // the backend enforces one active RINGING/ACCEPTED call per user —
      // but never risk clobbering it or wrong-acting on it if it somehow
      // happens).
      const existingActive = activeCallRef.current;
      if (existingActive && existingActive.call.id !== callId) {
        return 'discarded';
      }

      const role: 'caller' | 'callee' = call.caller.id === userId ? 'caller' : 'callee';

      // Synchronize activeCallRef before delegating — same reasoning as
      // handleNativeAnswer above: decline/cancel/endCallAction all read
      // activeCallRef.current as their very first step.
      const nextActiveCall: ActiveCall = existingActive
        ? { ...existingActive, call }
        : { call, livekit: null, role, isCallKitManaged: true };
      activeCallRef.current = nextActiveCall;
      setActiveCall(nextActiveCall);

      // CallKit already knows this call is ending — the user just acted on
      // its system UI, which is why this intent exists. Suppress the
      // reflexive native-end sync that applyTerminalOutcome will otherwise
      // fire once the resulting terminal outcome lands, avoiding a
      // redundant round trip back into CallKit for a call it already
      // closed.
      suppressNativeEndSync(callId);

      if (call.status === 'RINGING') {
        if (role === 'callee') {
          await declineCallAction();
        } else {
          await cancelCallAction();
        }
      } else if (call.status === 'ACCEPTED') {
        await endCallAction();
      } else {
        return 'discarded';
      }

      if (!isNativeIntentSessionStillValid(session)) return 'discarded';

      // declineCallAction/cancelCallAction/endCallAction all route through
      // runLifecycleAction, which never throws and only reconciles local UI
      // on failure — it doesn't tell this handler definitively whether the
      // server actually reached a terminal state. Confirm with our own
      // authoritative read before ever reporting 'handled'.
      let confirmed: CallSummary | null = null;
      let outcome: NativeCallIntentResult;
      try {
        confirmed = await getCallApi(token, callId);
        outcome = resolveEndConfirmation({ networkError: false, serverIsTerminal: TERMINAL_STATUSES.has(confirmed.status) });
      } catch {
        // Still no network — coordinator retries; a re-run safely re-sends
        // the same idempotent decline/cancel/end.
        outcome = resolveEndConfirmation({ networkError: true });
      }
      if (!isNativeIntentSessionStillValid(session)) return 'discarded';

      if (outcome === 'handled' && confirmed) {
        const latest = activeCallRef.current;
        if (latest?.call.id === callId && !TERMINAL_STATUSES.has(latest.call.status)) {
          // The internal reconcile path hasn't caught up yet — apply it
          // ourselves. Re-suppress: CallKit's system UI already reflects
          // the user's own end/decline/cancel action from moments ago, so a
          // redundant native-end round trip is still unwanted here even
          // though this particular confirmation read is the one noticing
          // the terminal state.
          suppressNativeEndSync(callId);
          applyTerminalOutcome(confirmed, confirmed.caller.id === userId ? 'caller' : 'callee');
        }
      }

      return outcome;
    },
    [
      captureNativeIntentSession,
      isNativeIntentSessionStillValid,
      applyTerminalOutcome,
      cancelCallAction,
      declineCallAction,
      endCallAction,
      suppressNativeEndSync,
    ]
  );

  // CallProvider is mounted once above the auth-gated navigator and in
  // practice never unmounts (see the comment on the accessToken effect
  // above), but clear both retry timers on unmount defensively anyway —
  // matches every other timer in this file being cleaned up on unmount.
  useEffect(() => {
    return () => {
      if (mediaFailureRetryTimerRef.current) {
        clearTimeout(mediaFailureRetryTimerRef.current);
        mediaFailureRetryTimerRef.current = null;
      }
      if (confirmRetryTimerRef.current) {
        clearTimeout(confirmRetryTimerRef.current);
        confirmRetryTimerRef.current = null;
      }
    };
  }, []);

  return (
    <CallContext.Provider
      value={{
        phase,
        activeCall,
        startCall,
        acceptCall,
        declineCall: declineCallAction,
        cancelCall: cancelCallAction,
        endCall: endCallAction,
        reportMediaConnected,
        reportMediaDisconnected,
        reportMediaFailure,
        confirmCallOrFail,
        handleNativeIncoming,
        handleNativeAnswer,
        handleNativeEnd,
        handleNativeAudioSessionActivated,
        handleNativeAudioSessionDeactivated,
        handleNativeCallKitCallIdSeen,
        isPrivateCallAudioAuthorized,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within a CallProvider');
  return ctx;
}
