import { useEffect, useRef } from 'react';
import { useCall } from '@/contexts/call';
import { useAccessToken } from '@/queries/auth';
import { useAuth } from '@/contexts/auth';
import { registerVoipDevice, unregisterVoipDevice } from '@/lib/api';
import {
  isVoipPushKitNativeModuleAvailable,
  setupCallKeepOnce,
  registerVoipTokenOnce,
  nativeVoipModules,
  endNativeCallKitCall,
  isValidVoipToken,
  resolveApnsEnvironment,
  resolvePendingAfterUploadOutcome,
  resolveVoipTokenBindingDecision,
  shouldDeleteOldVoipToken,
  shouldScheduleNextVoipTokenUploadAfterSettle,
  voipTokenMarkerMatches,
  CALLKEEP_EVENTS,
  VOIP_PUSH_EVENTS,
  type ApnsEnvironment,
  type VoipRegisterEvent,
  type VoipTokenUploadMarker,
} from '@/lib/voipPushKit';
import {
  decideAuthIdentityTransition,
  enqueueDeduped,
  extractIncomingCallId,
  isEntryExpired,
  isValidCallId,
  removeEntriesForCallId,
  resolveExpiredIncomingDisposition,
  retryBackoffMs,
  shouldRescheduleDrainAfterExit,
  type NativeCallIntentQueueEntry,
  type NativeCallIntentResult,
  type NativeCallIntentType,
} from '@/lib/nativeCallIntentQueue';

// Real native event name strings react-native-callkeep's `didLoadWithEvents`
// replay reports for cold-start actions — read directly from the installed
// package's own type declarations
// (node_modules/react-native-callkeep/index.d.ts `NativeEvents`), not
// guessed. Unlike react-native-voip-push-notification (which exposes its
// native event names as runtime static properties — see the
// RNVoipPushRemoteNotificationReceivedEvent usage below), react-native-callkeep
// does not, so the reverse (native name -> our event key) lookup
// `didLoadWithEvents` needs is mirrored here from the type file.
const CALLKEEP_NATIVE_EVENT_NAME_TO_INTENT: Record<string, NativeCallIntentType> = {
  RNCallKeepPerformAnswerCallAction: 'answer',
  RNCallKeepPerformEndCallAction: 'end',
  RNCallKeepDidDisplayIncomingCall: 'incoming',
};

function extractCallUUID(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const callUUID = (data as Record<string, unknown>).callUUID;
  return typeof callUUID === 'string' ? callUUID : null;
}

// Mounted alongside GlobalCallHost, inside AuthProvider + CallProvider (see
// app/_layout.tsx) — see docs/private-voice-calling-spec.md "iOS 原生能力".
//
// Pure plumbing only: translates native PushKit/CallKit events into
// CallProvider's handleNativeIncoming/handleNativeAnswer/handleNativeEnd
// entry points, and separately owns VoIP device token
// registration/upload/rotation/cleanup (POST/DELETE /calls/devices — see
// lib/api.ts's registerVoipDevice/unregisterVoipDevice). Never maintains its
// own Call state (no CallPhase/ActiveCall duplicate), never calls a Call
// lifecycle REST endpoint directly, and never calls
// onVoipNotificationCompleted (native PushKit completion stays solely
// RNCallKeep's — see lib/voipPushKit.ts). Renders nothing; safe no-op on
// Android, web, Expo Go, or any build where the native modules aren't
// linked.
export function IosVoipCallKitCoordinator(): null {
  const accessToken = useAccessToken();
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  // Session-boundary identity comes from AuthContext's own Supabase auth
  // state (loading + session.user.id), NOT the async `useCurrentUser()` REST
  // profile query. dbUserId only resolves after a separate /me round trip
  // completes, which lags behind — and starts at `null` — well after cold
  // start; treating its very first null -> real-id transition as "a login"
  // was what wiped the pending queue before PushKit/CallKit cold-start
  // events (which race that same /me call) ever got processed. `loading`
  // tells us precisely when the INITIAL session restore is still pending
  // (queue must survive untouched) versus genuinely settled.
  const { session, loading: authLoading } = useAuth();
  const authUserId = session?.user.id ?? null;
  // Synced every render so any closure — including one invoked much later
  // from a setTimeout/Promise callback captured on an older render — always
  // reads the CURRENT identity rather than whatever `authUserId` value that
  // older closure happened to close over. accessTokenRef already does this;
  // the VoIP token registration fix below needs the same for authUserId.
  const authUserIdRef = useRef(authUserId);
  authUserIdRef.current = authUserId;

  const {
    handleNativeIncoming,
    handleNativeAnswer,
    handleNativeEnd,
    handleNativeAudioSessionActivated,
    handleNativeAudioSessionDeactivated,
    handleNativeCallKitCallIdSeen,
  } = useCall();
  const handlersRef = useRef({
    handleNativeIncoming,
    handleNativeAnswer,
    handleNativeEnd,
    handleNativeAudioSessionActivated,
    handleNativeAudioSessionDeactivated,
    handleNativeCallKitCallIdSeen,
  });
  handlersRef.current = {
    handleNativeIncoming,
    handleNativeAnswer,
    handleNativeEnd,
    handleNativeAudioSessionActivated,
    handleNativeAudioSessionDeactivated,
    handleNativeCallKitCallIdSeen,
  };

  // Bounded, deduped FIFO queue for native events that arrive before
  // Supabase auth is restored (cold start) or that need retrying — see
  // lib/nativeCallIntentQueue.ts for the pure enqueue/expiry/backoff logic.
  const queueRef = useRef<NativeCallIntentQueueEntry[]>([]);
  // Bumped on every REAL identity change (mirrors CallProvider's own
  // recoveryGenerationRef idiom) — invalidates the queue and any in-flight
  // drain the instant the user logs out/switches accounts, so a native
  // event queued/being processed for the previous identity can never act
  // under the new one. Deliberately NOT bumped for the initial
  // loading -> resolved transition (see the effect below) — that is not a
  // login/logout/switch, just finding out what the restored session already
  // was.
  const generationRef = useRef(0);
  const drainingRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the initial auth restoration (AuthProvider's first
  // getSession()/onAuthStateChange settling) has completed at least once.
  const authInitializedRef = useRef(false);
  const previousAuthUserIdRef = useRef<string | null>(null);

  const clearDrainTimer = () => {
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
  };

  const scheduleDrain = (delayMs: number) => {
    if (drainTimerRef.current) return; // one scheduled drain at a time — never a tight loop
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      void drainQueue();
    }, delayMs);
  };

  // Processes the queue strictly one entry at a time, oldest first. A
  // single in-flight drain (drainingRef) is a simple, sufficient way to
  // guarantee "each callId is processed serially, never answer/end
  // concurrently" — a stricter global guarantee that trivially implies the
  // per-callId requirement, without extra per-key concurrency bookkeeping.
  const drainQueue = async () => {
    if (drainingRef.current) return;
    if (!accessTokenRef.current) return; // no auth yet — re-triggered once it appears (see effect below)
    if (queueRef.current.length === 0) return;

    drainingRef.current = true;
    const generation = generationRef.current;

    try {
      while (queueRef.current.length > 0) {
        if (generationRef.current !== generation) return; // identity switched mid-drain — abandon
        if (!accessTokenRef.current) return; // auth lost mid-drain

        const [entry, ...rest] = queueRef.current;

        // Only 'incoming' entries can expire (see isEntryExpired) —
        // 'answer'/'end' are user actions that stay queued through a TTL
        // window and rely solely on MAX_QUEUE_LENGTH/generation invalidation
        // to stay bounded.
        if (isEntryExpired(entry, Date.now())) {
          const disposition = resolveExpiredIncomingDisposition(rest, entry);
          if (disposition === 'close-stale-callkit') {
            // No queued answer/end for this callId — this is a genuinely
            // stale, never-answered incoming call. Safe to tell CallKit to
            // close its display; if a following answer/end existed instead,
            // closing here would tear down the very call it's about to act
            // on, so that case is left untouched (silent-drop).
            void endNativeCallKitCall(entry.callId, 'unanswered');
          }
          queueRef.current = rest;
          continue;
        }

        let result: NativeCallIntentResult;
        try {
          if (entry.type === 'incoming') result = await handlersRef.current.handleNativeIncoming(entry.callId);
          else if (entry.type === 'answer') result = await handlersRef.current.handleNativeAnswer(entry.callId);
          else result = await handlersRef.current.handleNativeEnd(entry.callId);
        } catch (error) {
          console.warn('[voip-coordinator] native intent handler threw unexpectedly:', error);
          result = 'retry';
        }

        if (generationRef.current !== generation) return; // superseded while the handler was awaiting

        if (result === 'retry') {
          // Keep this entry at the front (it's the oldest, so its
          // ringing/answering/ending window is the most urgent) and back
          // off before trying again — never a 0ms tight loop.
          const delay = retryBackoffMs(retryAttemptRef.current);
          retryAttemptRef.current += 1;
          scheduleDrain(delay);
          return;
        }

        retryAttemptRef.current = 0;
        // 'discarded' means this callId is now known invalid/non-participant/
        // already-terminal-and-cleaned-up — any other queued intents for
        // the SAME call (e.g. a queued 'end' behind an 'incoming' that
        // turned out to be a dead call) are moot too; purge them so they
        // don't get processed (and re-validated) for nothing.
        queueRef.current = result === 'discarded' ? removeEntriesForCallId(rest, entry.callId) : rest;
      }
    } finally {
      drainingRef.current = false;

      // Covers the case where the while loop above exited early (identity
      // switched mid-await, see generation checks) while a NEWER
      // generation's event was already enqueued and its own scheduleDrain(0)
      // call no-oped because drainingRef was still true at that moment —
      // without this, that event would stay queued but never get drained
      // again. shouldRescheduleDrainAfterExit is a pure function (see
      // lib/nativeCallIntentQueue.ts) specifically so this decision is
      // unit-testable without a React harness.
      if (
        shouldRescheduleDrainAfterExit({
          queueLength: queueRef.current.length,
          hasAccessToken: Boolean(accessTokenRef.current),
          hasScheduledTimer: drainTimerRef.current !== null,
        })
      ) {
        scheduleDrain(0);
      }
    }
  };

  const enqueue = (type: NativeCallIntentType, callId: string) => {
    if (!isValidCallId(callId)) return;
    if (type === 'incoming' || type === 'answer') {
      // Fixes a real race (Gate requirement): notify CallProvider of this
      // CallKit callId THE INSTANT it's seen — well before this queue even
      // drains and handleNativeIncoming/handleNativeAnswer's own REST GET
      // completes. Without this, a didActivateAudioSession arriving during
      // that GET found nothing tracked yet (see
      // resolveCallKitAudioActivation's managedCallId===null guard) and was
      // silently dropped, permanently leaving LiveKit's `connect` gate
      // false for that call. Only starts audio tracking — never creates
      // activeCall, requests a token, or calls accept.
      handlersRef.current.handleNativeCallKitCallIdSeen(callId);
    }
    queueRef.current = enqueueDeduped(queueRef.current, { type, callId, enqueuedAt: Date.now() });
    scheduleDrain(0);
  };
  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;

  // ---------------------------------------------------------------------------
  // VoIP token registration/upload/rotation/cleanup — reuses this
  // coordinator's OWN identity generation (generationRef above, shared with
  // the native call-intent queue) rather than inventing a second one.
  // ---------------------------------------------------------------------------

  // The most recent VALIDATED raw native token, with no identity attached at
  // all — updated the instant a 'register'/didLoadWithEvents-replayed event
  // arrives, regardless of whether auth has restored yet. This is the single
  // source of truth for "what token does this device currently have";
  // VoipRegisterEvent (token + a REAL authUserId) is only ever constructed
  // FROM this when an identity is actually available to bind it to (see
  // bindLatestTokenToCurrentIdentity below) — never the reverse. Survives
  // every identity switch/logout untouched (the native PushKit token itself
  // doesn't change just because the app's own session did), so a newly
  // logged-in identity can be bound to it without waiting for native to
  // re-emit 'register'.
  const latestNativeVoipTokenRef = useRef<string | null>(null);

  const nextVoipTokenRequestIdRef = useRef(0);
  // The single in-flight upload POST recognized as authoritative — same
  // requestId/generation/authUserId marker idiom as contexts/call.tsx's
  // AcceptMarker (see lib/voipPushKit.ts's voipTokenMarkerMatches).
  const voipTokenInFlightRef = useRef<VoipTokenUploadMarker | null>(null);
  const voipTokenInFlightPromiseRef = useRef<Promise<void> | null>(null);
  // The latest register event still awaiting a successful upload — set as
  // soon as a 'register' event arrives (even before auth is ready — see the
  // accessToken-ready effect below) and only ever cleared by
  // resolvePendingAfterUploadOutcome once an upload for EXACTLY this event
  // succeeds. Never cleared just because an upload attempt failed.
  const pendingVoipTokenRef = useRef<VoipRegisterEvent | null>(null);
  // Dedupes a repeated native 'register' event (e.g. a didLoadWithEvents
  // replay, or the native module re-emitting its last known token) carrying
  // the exact same (token, authUserId, environment) — see
  // voipRegisterEventsEqual.
  const lastHandledVoipTokenEventRef = useRef<VoipRegisterEvent | null>(null);
  // The last token this exact identity successfully got the backend to
  // acknowledge — used both to know what to best-effort delete on a
  // same-identity token rotation (shouldDeleteOldVoipToken) and what to
  // best-effort delete on logout/switch (see the identity effect below).
  const uploadedVoipTokenRef = useRef<{ token: string; authUserId: string; environment: ApnsEnvironment } | null>(
    null
  );
  const voipTokenRetryAttemptRef = useRef(0);
  const voipTokenRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captured via a dedicated effect's cleanup (see below) rather than a
  // plain per-render ref sync — by the time the identity-change effect
  // detects a real switch/logout, accessTokenRef.current already reflects
  // the NEW session (or null), so the OUTGOING identity's own token, needed
  // to authenticate its best-effort device-token deletion, must be captured
  // from the previous render's closure instead.
  const previousAccessTokenRef = useRef<string | null>(null);

  const clearVoipTokenRetryTimer = () => {
    if (voipTokenRetryTimerRef.current) {
      clearTimeout(voipTokenRetryTimerRef.current);
      voipTokenRetryTimerRef.current = null;
    }
  };

  const scheduleVoipTokenRetry = (delayMs: number) => {
    if (voipTokenRetryTimerRef.current) return; // one scheduled retry at a time — never a tight loop
    voipTokenRetryTimerRef.current = setTimeout(() => {
      voipTokenRetryTimerRef.current = null;
      void attemptVoipTokenUpload();
    }, delayMs);
  };

  // Combined validity check for an in-flight upload attempt's marker —
  // checked after EVERY await, not just via voipTokenMarkerMatches (which
  // only tells us "does the in-flight ref still point at my marker"). The
  // separate authUserIdRef/generationRef comparisons are redundant with a
  // correctly-functioning voipTokenMarkerMatches check in practice (both are
  // invalidated atomically by the same identity effect), but are kept as
  // explicit, independently-auditable checks — mirroring
  // contexts/call.tsx's isNativeIntentSessionStillValid, which does the same
  // multi-check-instead-of-one-derived-check for the same reason.
  function isVoipTokenAttemptStillValid(marker: VoipTokenUploadMarker): boolean {
    return (
      authUserIdRef.current === marker.authUserId &&
      generationRef.current === marker.generation &&
      voipTokenMarkerMatches(voipTokenInFlightRef.current, marker)
    );
  }

  // Uploads whatever is in pendingVoipTokenRef, if anything, deduping onto
  // an already in-flight attempt for the SAME identity generation instead of
  // sending a second POST — mirrors contexts/call.tsx's acceptCallAction
  // dedup/reuse pattern exactly.
  function attemptVoipTokenUpload(): Promise<void> {
    const pending = pendingVoipTokenRef.current;
    if (!pending) return Promise.resolve();
    // pending.authUserId is only ever set by bindLatestTokenToCurrentIdentity,
    // which requires a real, current authUserId before constructing it — so
    // this is normally always true. Checked explicitly anyway (Gate
    // requirement) rather than trusted implicitly, and re-checked against
    // the LIVE identity in case it moved on since this was queued.
    if (pending.authUserId !== authUserIdRef.current) return Promise.resolve();
    const token = accessTokenRef.current;
    if (!token) return Promise.resolve(); // no auth yet — the accessToken-ready effect below retriggers this

    const generation = generationRef.current;
    const authUserId = pending.authUserId;

    // Reuse an already in-flight attempt for the SAME identity generation
    // instead of sending a second POST — mirrors acceptCallAction's dedup.
    const existing = voipTokenInFlightRef.current;
    if (existing && existing.generation === generation && existing.authUserId === authUserId) {
      return voipTokenInFlightPromiseRef.current ?? Promise.resolve();
    }

    const requestId = ++nextVoipTokenRequestIdRef.current;
    const marker: VoipTokenUploadMarker = { requestId, generation, authUserId };

    const attempt = (async () => {
      let succeeded = false;
      try {
        await registerVoipDevice(token, { token: pending.token, platform: 'IOS', environment: pending.environment });
        succeeded = true;
      } catch {
        // Fixed categorical text only — never error.message (could echo a
        // request URL or third-party response text that embeds the token).
        console.warn('[voip] VoIP device token upload failed — will retry');
      }

      if (!isVoipTokenAttemptStillValid(marker)) return; // superseded while the POST was in flight

      pendingVoipTokenRef.current = resolvePendingAfterUploadOutcome(pendingVoipTokenRef.current, pending, succeeded);

      if (succeeded) {
        voipTokenRetryAttemptRef.current = 0;
        const previousUploaded = uploadedVoipTokenRef.current;
        uploadedVoipTokenRef.current = { token: pending.token, authUserId, environment: pending.environment };

        if (
          previousUploaded &&
          previousUploaded.authUserId === authUserId &&
          shouldDeleteOldVoipToken({ uploadSucceeded: true, oldToken: previousUploaded.token, newToken: pending.token })
        ) {
          // Best-effort: the new token is already confirmed uploaded, so a
          // failure to delete the rotated-out old one just leaves a stale
          // (harmless, eventually-unreachable) device row — never retried.
          unregisterVoipDevice(token, previousUploaded.token).catch(() => {
            console.warn('[voip] best-effort deletion of the rotated-out VoIP token failed (non-fatal)');
          });
        }
      } else {
        const delay = retryBackoffMs(voipTokenRetryAttemptRef.current);
        voipTokenRetryAttemptRef.current += 1;
        scheduleVoipTokenRetry(delay);
      }
    })().finally(() => {
      // Only release the lock if it's still exactly this attempt's marker —
      // a newer attempt (a different requestId/generation/authUserId after
      // a switch) or the identity effect already clearing it outright must
      // never have its lock cleared by this one settling late.
      const wasMine = voipTokenMarkerMatches(voipTokenInFlightRef.current, marker);
      if (wasMine) {
        voipTokenInFlightRef.current = null;
        voipTokenInFlightPromiseRef.current = null;
      }

      // A newer register event may have arrived (and been left correctly
      // pending by resolvePendingAfterUploadOutcome above) while THIS
      // attempt monopolized the "one upload in flight" slot — without this,
      // that pending token would never get picked up again. Only schedules
      // when nothing else already will (no retry timer, no other in-flight
      // attempt) and the pending token still belongs to the CURRENT
      // identity — see shouldScheduleNextVoipTokenUploadAfterSettle.
      const stillPending = pendingVoipTokenRef.current;
      if (
        shouldScheduleNextVoipTokenUploadAfterSettle({
          hasPendingToken: !!stillPending,
          hasAccessToken: Boolean(accessTokenRef.current),
          pendingOwnerMatchesCurrentAuthUserId: !!stillPending && stillPending.authUserId === authUserIdRef.current,
          hasScheduledRetryTimer: voipTokenRetryTimerRef.current !== null,
          hasOtherInFlightUpload: voipTokenInFlightRef.current !== null,
        })
      ) {
        void attemptVoipTokenUpload();
      }
    });

    voipTokenInFlightRef.current = marker;
    voipTokenInFlightPromiseRef.current = attempt;
    return attempt;
  }

  // Promotes latestNativeVoipTokenRef into a VoipRegisterEvent bound to the
  // CURRENT identity and enters it into pending/upload — but only once a
  // real authUserId and accessToken both exist. Called both right after a
  // native token event updates latestNativeVoipTokenRef (in case identity is
  // already ready) and whenever identity/auth becomes ready (cold-start
  // baseline, post-switch, or a plain token refresh — see the
  // accessToken-ready effect below), so the SAME native token gets
  // (re-)bound to whichever identity is actually current without waiting
  // for native to re-emit 'register'.
  function bindLatestTokenToCurrentIdentity() {
    // resolveVoipTokenBindingDecision is a pure function (see
    // lib/voipTokenRegistration.ts) precisely so the cold-start/logout/
    // A->B/token-refresh binding rules are unit-testable without a React
    // harness — this only carries out whichever action it decides.
    const environment = resolveApnsEnvironment();
    const decision = resolveVoipTokenBindingDecision({
      latestToken: latestNativeVoipTokenRef.current,
      currentAuthUserId: authUserIdRef.current,
      hasAccessToken: Boolean(accessTokenRef.current),
      environment,
      lastHandled: lastHandledVoipTokenEventRef.current,
    });

    if (decision.action === 'skip') {
      // Fail-closed environment is the one 'skip' case worth a categorized
      // warning — the others (no token yet, logged out, no access token,
      // already bound) are all expected, silent no-ops.
      if (latestNativeVoipTokenRef.current && authUserIdRef.current && accessTokenRef.current && !environment) {
        console.warn('[voip] APNs environment is not configured for this build — VoIP token upload skipped');
      }
      return;
    }

    lastHandledVoipTokenEventRef.current = decision.event;
    pendingVoipTokenRef.current = decision.event;
    voipTokenRetryAttemptRef.current = 0;
    clearVoipTokenRetryTimer();
    void attemptVoipTokenUpload();
  }

  // Entry point for both a live native 'register' event and a
  // didLoadWithEvents replay of one (see the listener-setup effect below).
  // Never logs the raw token value. Updates latestNativeVoipTokenRef
  // UNCONDITIONALLY — regardless of whether auth has restored yet — since
  // that ref deliberately carries no identity binding; only
  // bindLatestTokenToCurrentIdentity ever promotes it into an upload.
  function handleVoipTokenEvent(rawToken: unknown) {
    if (!isValidVoipToken(rawToken)) {
      console.warn('[voip] received an invalid/empty VoIP token — ignoring');
      return;
    }
    latestNativeVoipTokenRef.current = rawToken;
    bindLatestTokenToCurrentIdentity();
  }
  const handleVoipTokenEventRef = useRef(handleVoipTokenEvent);
  handleVoipTokenEventRef.current = handleVoipTokenEvent;

  // Identity change: invalidate the queue and any in-flight/scheduled drain
  // — see generationRef above — but ONLY for a real post-initialization
  // login/logout/switch, never for the one-time "we just found out what the
  // restored session already was" transition that follows a cold start.
  useEffect(() => {
    // decideAuthIdentityTransition is a pure function (see
    // lib/nativeCallIntentQueue.ts) precisely so this cold-start-vs-real-
    // switch distinction is unit-testable without a React harness — this
    // effect only carries out whichever action it decides.
    const decision = decideAuthIdentityTransition({
      authInitialized: authInitializedRef.current,
      previousAuthUserId: previousAuthUserIdRef.current,
      authLoading,
      authUserId,
    });

    if (decision.action === 'wait' || decision.action === 'noop') return;

    if (decision.action === 'baseline') {
      // First resolution of AuthProvider's initial getSession() — this is
      // not a login/logout/switch event (there was no "previous" identity
      // to switch away from), so any native events queued while loading was
      // true (the exact cold-start race this fixes) must survive untouched.
      authInitializedRef.current = true;
      previousAuthUserIdRef.current = decision.authUserId;
      return;
    }

    // decision.action === 'invalidate': A -> logout, A -> B, or logout -> B
    // after initialization — a native event still queued/being processed
    // for the OLD identity must never act under the new one.
    const outgoingAuthUserId = previousAuthUserIdRef.current;
    previousAuthUserIdRef.current = decision.authUserId;
    generationRef.current += 1;
    queueRef.current = [];
    retryAttemptRef.current = 0;
    clearDrainTimer();

    // Same invalidation for VoIP token registration — an upload/retry in
    // flight for the OLD identity must never write into the new one, and a
    // stale retry timer must not fire under it either. Deliberately does
    // NOT clear latestNativeVoipTokenRef: the native PushKit token itself
    // belongs to this DEVICE, not to whichever identity is currently logged
    // in, so it must survive every switch/logout untouched —
    // bindLatestTokenToCurrentIdentity (called once the new identity's own
    // auth becomes ready, see the accessToken-ready effect below) is what
    // re-binds this SAME token to the new identity without waiting for
    // native to re-emit 'register'.
    const outgoingAccessToken = previousAccessTokenRef.current;
    const outgoingUploadedToken = uploadedVoipTokenRef.current;
    voipTokenInFlightRef.current = null;
    voipTokenInFlightPromiseRef.current = null;
    pendingVoipTokenRef.current = null;
    lastHandledVoipTokenEventRef.current = null;
    uploadedVoipTokenRef.current = null;
    voipTokenRetryAttemptRef.current = 0;
    clearVoipTokenRetryTimer();

    // Best-effort: tell the backend the outgoing identity's device token no
    // longer belongs to it, using the outgoing identity's OWN access token
    // (captured via the dedicated effect below — accessTokenRef.current has
    // already moved on to the new session/null by this point). Never
    // retried; failure just leaves a harmless stale device row.
    if (
      outgoingUploadedToken &&
      outgoingAccessToken &&
      outgoingUploadedToken.authUserId === outgoingAuthUserId
    ) {
      unregisterVoipDevice(outgoingAccessToken, outgoingUploadedToken.token).catch(() => {
        // Fixed categorical text only — never error.message (could echo a
        // request URL or third-party response text that embeds the token).
        console.warn('[voip] best-effort deletion of the previous identity\'s VoIP token failed (non-fatal)');
      });
    }
  }, [authLoading, authUserId]);

  // Captured via cleanup (not a plain per-render sync) so the identity
  // effect above can always read the OUTGOING identity's own access token —
  // see previousAccessTokenRef's declaration above for why a plain ref sync
  // would already be overwritten by the time a real switch is detected.
  useEffect(() => {
    return () => {
      previousAccessTokenRef.current = accessToken;
    };
  }, [accessToken]);

  // Auth became available (initial cold-start resolution, token refresh, or
  // the identity settling post-switch) — drain whatever native events piled
  // up waiting for it, and (re-)bind latestNativeVoipTokenRef to whichever
  // identity is now current. bindLatestTokenToCurrentIdentity is what
  // actually covers: cold-start baseline unknown -> A (a token that arrived
  // while auth was still loading gets bound and uploaded here, without
  // waiting for native to re-emit 'register'); A -> B (the SAME native
  // token re-bound to B once B's own auth is ready); and a plain token
  // refresh with authUserId unchanged (a no-op — voipRegisterEventsEqual
  // inside it recognizes the identical already-bound event and skips
  // re-entering pending/re-POSTing). Also gated on accessToken since both
  // drainQueue and attemptVoipTokenUpload require it before attempting any
  // REST call.
  useEffect(() => {
    if (authLoading || !accessToken) return;
    retryAttemptRef.current = 0;
    scheduleDrain(0);
    bindLatestTokenToCurrentIdentity();
  }, [authLoading, accessToken, authUserId]);

  // RNCallKeep.setup() exactly once, plus listener registration. iOS +
  // native-module-available only — a safe no-op everywhere else (Android,
  // web, Expo Go, or a build without the native deps compiled in), and
  // setup()/listener failures are swallowed by the lib/voipPushKit.ts
  // helpers themselves (never crashes the app).
  useEffect(() => {
    if (!isVoipPushKitNativeModuleAvailable()) return;

    let cancelled = false;
    const callKeepListeners: { remove: () => void }[] = [];

    (async () => {
      await setupCallKeepOnce();
      if (cancelled) return;

      const callKeepBundle = await nativeVoipModules.getCallKeep();
      const voipPushModule = await nativeVoipModules.getVoipPush();
      if (cancelled) return;

      if (callKeepBundle) {
        const { CallKeep } = callKeepBundle;

        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.ANSWER_CALL, ({ callUUID }) => {
            enqueueRef.current('answer', callUUID);
          })
        );
        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.END_CALL, ({ callUUID }) => {
            enqueueRef.current('end', callUUID);
          })
        );
        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.DID_DISPLAY_INCOMING_CALL, ({ callUUID }) => {
            enqueueRef.current('incoming', callUUID);
          })
        );
        // No callId of their own (confirmed against the installed package's
        // EventsPayload type — both are `undefined`) and no REST call/retry
        // needed, so these are forwarded directly rather than going through
        // the native-intent queue — CallProvider's callKitAudioState (see
        // lib/callAudioCoordinator.ts) is what gives them call-scoped
        // meaning.
        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.DID_ACTIVATE_AUDIO_SESSION, () => {
            handlersRef.current.handleNativeAudioSessionActivated();
          })
        );
        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.DID_DEACTIVATE_AUDIO_SESSION, () => {
            handlersRef.current.handleNativeAudioSessionDeactivated();
          })
        );
        callKeepListeners.push(
          CallKeep.addEventListener(CALLKEEP_EVENTS.DID_LOAD_WITH_EVENTS, events => {
            if (!Array.isArray(events)) return;
            for (const event of events) {
              const intentType = CALLKEEP_NATIVE_EVENT_NAME_TO_INTENT[event?.name as string];
              const callUUID = extractCallUUID(event?.data);
              if (!intentType || !callUUID) continue;
              enqueueRef.current(intentType, callUUID);
            }
          })
        );
      }

      if (voipPushModule) {
        voipPushModule.addEventListener(VOIP_PUSH_EVENTS.NOTIFICATION, notification => {
          const callId = extractIncomingCallId(notification);
          if (callId) enqueueRef.current('incoming', callId);
        });

        // 'register' fires with the raw device token STRING (not an
        // object) as its sole argument — confirmed against the installed
        // package's index.d.ts EventsPayload (`register: string`) and its
        // native source (RNVoipPushNotificationManager.m hex-encodes
        // PKPushCredentials.token and emits it directly as the event body).
        voipPushModule.addEventListener(VOIP_PUSH_EVENTS.REGISTER, deviceToken => {
          handleVoipTokenEventRef.current(deviceToken);
        });

        voipPushModule.addEventListener(VOIP_PUSH_EVENTS.DID_LOAD_WITH_EVENTS, events => {
          if (!Array.isArray(events)) return;
          for (const event of events) {
            if (event?.name === voipPushModule.RNVoipPushRemoteNotificationReceivedEvent) {
              const callId = extractIncomingCallId(event.data);
              if (callId) enqueueRef.current('incoming', callId);
              continue;
            }
            // didLoadWithEvents CAN replay a cached 'register' event too —
            // the installed package's index.d.ts InitialEvent mapped type
            // includes `{ name: 'RNVoipPushRemoteNotificationsRegisteredEvent',
            // data: string }` as one of its variants (EventsPayload['register']
            // is `string`, same shape as the live event above).
            if (event?.name === voipPushModule.RNVoipPushRemoteNotificationsRegisteredEvent) {
              handleVoipTokenEventRef.current(event.data);
            }
          }
        });

        // Must come AFTER the 'register'/'notification'/'didLoadWithEvents'
        // listeners above are subscribed — matches the installed package's
        // own README usage order (subscribe first, call registerVoipToken()
        // last) so no emitted/replayed event can arrive before something is
        // listening for it.
        await registerVoipTokenOnce();
      }
    })();

    return () => {
      cancelled = true;
      callKeepListeners.forEach(listener => listener.remove());
      clearVoipTokenRetryTimer();
      nativeVoipModules.getVoipPush().then(mod => {
        mod?.removeEventListener(VOIP_PUSH_EVENTS.NOTIFICATION);
        mod?.removeEventListener(VOIP_PUSH_EVENTS.REGISTER);
        mod?.removeEventListener(VOIP_PUSH_EVENTS.DID_LOAD_WITH_EVENTS);
      });
    };
    // Runs once — RNCallKeep.setup()/registerVoipTokenOnce() must not be
    // re-invoked on every render (see their own module-level guards) and
    // listeners must not be repeatedly torn down/re-registered;
    // enqueueRef/handlersRef/handleVoipTokenEventRef keep the closures
    // inside always reading current data instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
