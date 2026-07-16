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
  type CallFailureReason,
  type CallSummary,
  type LiveKitCredentials,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { showToast } from '@/stores/toast.store';
import { useAccessToken } from '@/queries/auth';
import { useCurrentUser } from '@/queries/user.queries';

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
  const { data: currentUserData } = useCurrentUser();
  const dbUserId = currentUserData?.user.id ?? null;

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  const activeCallRef = useRef(activeCall);
  activeCallRef.current = activeCall;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
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
  // newer request. The generation counter (bumped on every dbUserId
  // identity change, see the effect below) is what makes the classic ABA
  // case safe: user A -> B -> A would otherwise leave a slow request from
  // the *first* A session looking identical (same userId) to a request
  // belonging to the second A session.
  const recoveryGenerationRef = useRef(0);
  const recoveryRequestRef = useRef<{ userId: string; generation: number; requestId: number } | null>(null);
  const nextRecoveryRequestIdRef = useRef(0);
  // Previous dbUserId, compared each render to detect identity changes
  // (login, logout, or switching between two accounts) — see the effect
  // below.
  const previousDbUserIdRef = useRef<string | null>(null);
  // A media/connection failure the app has already *decided* is real (mic
  // denied, LiveKit connection dead) but hasn't necessarily gotten the
  // server to acknowledge yet — persists across a POST /fail failure AND a
  // failed GET reconciliation, so it survives to be retried once the
  // network recovers instead of silently being lost. Cleared only once the
  // server confirms a terminal outcome, or the call/identity it belongs to
  // no longer applies (see resetToIdle).
  const pendingMediaFailureRef = useRef<{ callId: string; reason: CallFailureReason } | null>(null);
  const mediaFailureRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setActiveCall(null);
    setPhase('idle');
  }, [clearPoll]);

  // CallProvider lives above the auth-gated navigator (see app/_layout.tsx),
  // so it never unmounts on logout/account switch — clear any in-progress
  // call state ourselves instead of leaving a stale modal behind.
  useEffect(() => {
    if (!accessToken) resetToIdle();
  }, [accessToken, resetToIdle]);

  // Identity-change cleanup: fires whenever dbUserId actually changes —
  // login, logout, or switching between two accounts. Bumping the
  // generation here (before anything else) is what invalidates any
  // recovery request already in flight for the previous identity,
  // including the ABA case where dbUserId goes A -> B -> A and a slow
  // request from the *first* A session must not be mistaken for one
  // belonging to the second. The actual teardown (poll, timers, activeCall,
  // in-flight markers) only runs for a real switch/logout, not the initial
  // mount (previous === null).
  //
  // This effect deliberately does NOT itself call recovery for the new
  // identity — see the next effect below for why that has to happen on a
  // separate render.
  useEffect(() => {
    const previous = previousDbUserIdRef.current;
    previousDbUserIdRef.current = dbUserId;
    if (previous === dbUserId) return;

    recoveryGenerationRef.current += 1;

    if (previous !== null) {
      resetToIdle();
    }
  }, [dbUserId, resetToIdle]);

  const applyTerminalOutcome = useCallback(
    (call: CallSummary, role: 'caller' | 'callee') => {
      setActiveCall({ call, livekit: null, role });
      setPhase(call.status === 'FAILED' ? 'failed' : 'ended');
      clearPoll();

      const toast = terminalToastFor(call);
      if (toast) showToast(toast.message, toast.type);

      if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
      terminalTimerRef.current = setTimeout(resetToIdle, TERMINAL_DISPLAY_MS);
    },
    [clearPoll, resetToIdle]
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
          setActiveCall({ call: latest.call, livekit, role: latest.role });
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

      setActiveCall({ call, livekit: current.livekit, role: current.role });

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
  const reconcileAfterAcceptFailure = useCallback(
    async (callId: string) => {
      const token = accessTokenRef.current;
      if (!token) return;

      let call: CallSummary;
      try {
        call = await getCallApi(token, callId);
      } catch {
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
        setActiveCall({ call, livekit: current.livekit, role: current.role });
        setPhase(prev => (prev === 'connected' || prev === 'reconnecting' ? prev : 'connecting'));
        if (!current.livekit) ensureLiveKitToken(call, current.role);
        return;
      }

      // Still RINGING — the accept genuinely never landed. Restore the
      // incoming-call UI so the user can retry, with a clear error instead
      // of silently vanishing.
      setActiveCall({ call, livekit: null, role: current.role });
      setPhase('incomingRinging');
      showToast('Could not accept the call — please try again', 'error');
    },
    [applyTerminalOutcome, ensureLiveKitToken]
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

    setActiveCall({ call: incoming, livekit: null, role: 'callee' });
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
        setActiveCall({ call, livekit: null, role });
        setPhase(role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
        return;
      }

      if (call.status === 'ACCEPTED') {
        setActiveCall({ call, livekit: null, role });
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
      setActiveCall({ call, livekit: null, role: 'caller' });
      setPhase('outgoingRinging');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start call', 'error');
    }
  }, []);

  const acceptCallAction = useCallback(async () => {
    const token = accessTokenRef.current;
    const current = activeCallRef.current;
    if (!token || !current || current.role !== 'callee') return;

    const callId = current.call.id;
    setPhase('accepting');
    try {
      // acceptCall is now a pure state transition — it never carries LiveKit
      // credentials. Enter 'connecting' immediately on the ACCEPTED result,
      // then fetch credentials separately via ensureLiveKitToken.
      const result = await acceptCallApi(token, callId);
      setActiveCall({ call: result, livekit: null, role: 'callee' });
      setPhase('connecting');
      ensureLiveKitToken(result, 'callee');
    } catch {
      // Do not assume the accept never landed — a network error or a
      // dropped response can happen after the server already recorded
      // ACCEPTED. Reconcile against the server instead of resetting to
      // idle, which would otherwise split this side's state from the
      // caller's (who may already have observed ACCEPTED).
      await reconcileAfterAcceptFailure(callId);
    }
  }, [ensureLiveKitToken, reconcileAfterAcceptFailure]);

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
        setActiveCall({ call, livekit: null, role: current.role });
        setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
        return;
      }

      if (call.status === 'ACCEPTED') {
        // The call is actually still live — restore whichever of
        // connecting/connected/reconnecting matches the current media
        // state instead of the phase this action was trying to leave.
        // Existing LiveKit credentials must not be dropped.
        setActiveCall({ call, livekit: current.livekit, role: current.role });
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
        setActiveCall({ call, livekit: null, role: current.role });
        setPhase(current.role === 'caller' ? 'outgoingRinging' : 'incomingRinging');
      } else if (call.status === 'ACCEPTED') {
        setActiveCall({ call, livekit: current.livekit, role: current.role });
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
        acceptCall: acceptCallAction,
        declineCall: declineCallAction,
        cancelCall: cancelCallAction,
        endCall: endCallAction,
        reportMediaConnected,
        reportMediaDisconnected,
        reportMediaFailure,
        confirmCallOrFail,
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
