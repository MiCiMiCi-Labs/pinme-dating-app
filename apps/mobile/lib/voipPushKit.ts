import { NativeModules, Platform } from 'react-native';

// iOS PushKit/CallKit native plumbing boundary (see
// docs/private-voice-calling-spec.md "iOS 原生能力").
//
// Token registration/upload is now active (see registerVoipTokenOnce and the
// VoipRegisterEvent helpers below), called from
// components/ios-voip-callkit-coordinator.tsx. It was safe to turn on only
// once the native "push received -> reportNewIncomingCall" path (see
// `plugins/withVoipPushKit.js`) was already verified end-to-end — iOS
// requires that a received VoIP push be reported to CallKit synchronously in
// native code, before JS/Realtime/REST have a chance to run, so registering
// for real pushes before that path was ready could have gotten the app
// terminated or de-prioritized for further VoIP push delivery.
//
// Nothing here writes the Supabase access token, the APNs/VoIP device token,
// or any part of `contexts/call.tsx`'s call state machine to
// AsyncStorage/SecureStore — the pending/uploaded token bookkeeping lives
// entirely in the coordinator's in-memory refs and is lost (by design) on
// app restart, re-established the next time the native 'register' event
// (re-)fires.

export const isVoipPushKitSupportedPlatform = Platform.OS === 'ios';

// True only when both native modules are actually linked into this binary
// — i.e. a custom dev/EAS build with the native deps compiled in. Always
// false in Expo Go and on Android; checking `NativeModules` directly (never
// importing the `react-native-callkeep`/`react-native-voip-push-notification`
// packages' JS entry points) means this can never throw just from being
// evaluated on a platform/build where the native side isn't present.
export function isVoipPushKitNativeModuleAvailable(): boolean {
  if (!isVoipPushKitSupportedPlatform) return false;
  return Boolean(NativeModules.RNVoipPushNotificationManager) && Boolean(NativeModules.RNCallKeep);
}

export type CallKeepSetupOptions = {
  ios: {
    appName: string;
    supportsVideo: boolean;
    maximumCallsPerCallGroup: string;
    maximumCallGroups: string;
  };
};

// Matches docs/private-voice-calling-spec.md "CallKit 配置": audio-only,
// one call at a time. Intended to be passed to RNCallKeep.setup() by a
// future task — not called anywhere from this module.
export const CALLKEEP_SETUP_OPTIONS: CallKeepSetupOptions = {
  ios: {
    appName: 'PinMe',
    supportsVideo: false,
    maximumCallsPerCallGroup: '1',
    maximumCallGroups: '1',
  },
};

// Event names emitted by react-native-voip-push-notification's JS API.
// Not subscribed to anywhere yet.
//
// Completion ownership: `plugins/withVoipPushKit.js`'s native bridge
// (PinMeVoipBridge.m) never registers the PushKit completion handler with
// RNVoipPushNotificationManager — only RNCallKeep's own
// `withCompletionHandler:` (passed straight through from
// `pushRegistry:didReceiveIncomingPushWithPayload:...`) ever calls it, so
// there is nothing for a completion block to be "completed" from the JS
// side. A future task wiring up `NOTIFICATION` handling must NOT call
// `RNVoipPushNotification.onVoipNotificationCompleted(uuid)` (or any
// equivalent completion-forwarding API) for pushes that went through this
// bridge — that completion was never handed to
// RNVoipPushNotificationManager to begin with.
export const VOIP_PUSH_EVENTS = {
  REGISTER: 'register',
  NOTIFICATION: 'notification',
  DID_LOAD_WITH_EVENTS: 'didLoadWithEvents',
} as const;

// Event names emitted by react-native-callkeep's JS API that a future task
// will need to listen for. Not subscribed to anywhere yet.
export const CALLKEEP_EVENTS = {
  ANSWER_CALL: 'answerCall',
  END_CALL: 'endCall',
  DID_DISPLAY_INCOMING_CALL: 'didDisplayIncomingCall',
  DID_LOAD_WITH_EVENTS: 'didLoadWithEvents',
  DID_ACTIVATE_AUDIO_SESSION: 'didActivateAudioSession',
  DID_DEACTIVATE_AUDIO_SESSION: 'didDeactivateAudioSession',
} as const;

// ---------------------------------------------------------------------------
// Runtime coordinator support (this phase 3 task) — lazy, guarded access to
// the two native module JS APIs, RNCallKeep.setup() run exactly once, and a
// safe "close this native call" helper. Still no token
// registration/upload: `registerVoipToken` and `onVoipNotificationCompleted`
// are never called anywhere in this file.
// ---------------------------------------------------------------------------

// What a CallProvider native-intent handler reports back to the coordinator
// — re-exported from nativeCallIntentQueue.ts so callers only need one
// import path for the type most of them actually use.
export type { NativeCallIntentResult } from './nativeCallIntentQueue';

// react-native-callkeep's `IOptions` type requires a structurally complete
// `android` block even though `RNCallKeep.setup()` is only ever invoked
// here when `Platform.OS === 'ios'` (see setupCallKeepOnce below) — this
// stub satisfies that type requirement without requesting any Android
// phone-account permission at runtime (`additionalPermissions: []`, and the
// android branch of setup() is simply never reached).
const CALLKEEP_ANDROID_STUB = {
  alertTitle: 'Unused',
  alertDescription: 'Unused — PinMe VoIP calling is iOS-only in this phase.',
  cancelButton: 'Cancel',
  okButton: 'OK',
  additionalPermissions: [] as string[],
};

type RNCallKeepModule = typeof import('react-native-callkeep').default;
// `CONSTANTS` (END_CALL_REASONS) is a separate named export alongside the
// default-exported class — checked against the real installed module's
// index.js, not just the .d.ts — so it must be captured from the module
// namespace itself, not read as a static property of the default class.
type RNCallKeepConstants = typeof import('react-native-callkeep').CONSTANTS;
type RNVoipPushNotificationModule = typeof import('react-native-voip-push-notification').default;

type CallKeepModuleBundle = { CallKeep: RNCallKeepModule; CONSTANTS: RNCallKeepConstants };

let callKeepModulePromise: Promise<CallKeepModuleBundle | null> | null = null;
let voipPushModulePromise: Promise<RNVoipPushNotificationModule | null> | null = null;

// Dynamic (never static top-level) imports — a static `import ... from
// 'react-native-callkeep'` would evaluate that package's own module-level
// code on every platform this file is bundled for, including Android/web,
// where the native module isn't linked. Guarding on
// isVoipPushKitNativeModuleAvailable() first, then dynamically importing,
// means this can never throw just from being evaluated on an unsupported
// platform or in Expo Go.
async function getCallKeepModule(): Promise<CallKeepModuleBundle | null> {
  if (!isVoipPushKitNativeModuleAvailable()) return null;
  callKeepModulePromise ??= import('react-native-callkeep')
    .then(mod => ({ CallKeep: mod.default, CONSTANTS: mod.CONSTANTS }))
    .catch(error => {
      console.warn('[voip] react-native-callkeep is not available in this build:', error);
      return null;
    });
  return callKeepModulePromise;
}

async function getVoipPushModule(): Promise<RNVoipPushNotificationModule | null> {
  if (!isVoipPushKitNativeModuleAvailable()) return null;
  voipPushModulePromise ??= import('react-native-voip-push-notification')
    .then(mod => mod.default)
    .catch(error => {
      console.warn('[voip] react-native-voip-push-notification is not available in this build:', error);
      return null;
    });
  return voipPushModulePromise;
}

// Exposed so the coordinator component can subscribe/unsubscribe listeners
// on the real modules without each call site re-deriving the same
// availability + dynamic-import dance.
export const nativeVoipModules = {
  getCallKeep: getCallKeepModule,
  getVoipPush: getVoipPushModule,
};

let callKeepSetupPromise: Promise<void> | null = null;

// Runs RNCallKeep.setup() exactly once for the lifetime of the JS runtime
// (module-level guard — safe across CallProvider/coordinator remounts,
// which do not happen in practice but cost nothing to guard against
// anyway). Never throws: a setup failure is logged and swallowed, since a
// broken CallKit registration must not crash foreground calling, which does
// not depend on it.
export function setupCallKeepOnce(): Promise<void> {
  callKeepSetupPromise ??= (async () => {
    const bundle = await getCallKeepModule();
    if (!bundle) return;
    try {
      await bundle.CallKeep.setup({
        ios: CALLKEEP_SETUP_OPTIONS.ios,
        android: CALLKEEP_ANDROID_STUB,
      });
    } catch (error) {
      console.warn('[voip] RNCallKeep.setup() failed (non-fatal):', error);
    }
  })();
  return callKeepSetupPromise;
}

// Semantic reason a call ended, mapped to RNCallKeep.CONSTANTS.END_CALL_REASONS
// at call time (never hardcoded numbers — read from the real installed
// module so a future react-native-callkeep upgrade that renumbers these
// can't silently desync). `remoteEnded` is the conservative default for any
// terminal outcome this device's own CallKit answer/end action didn't just
// cause (see contexts/call.tsx's native-end suppression marker) — see
// docs/private-voice-calling-spec.md for why DECLINED/CANCELED/ENDED all
// collapse to it rather than a finer (unverifiable) distinction.
export type NativeCallEndReason = 'failed' | 'remoteEnded' | 'unanswered';

// Best-effort: tells CallKit a call is over when the server's truth reached
// a terminal state that CallKit doesn't yet know about (e.g. the other
// party ended the call, or this device discovers via REST that a call it's
// displaying/answering is already dead). No-op on Android/Expo Go/when the
// native module isn't linked, and never throws.
export async function endNativeCallKitCall(callId: string, reason: NativeCallEndReason): Promise<void> {
  const bundle = await getCallKeepModule();
  if (!bundle) return;
  try {
    const reasonCode =
      reason === 'failed'
        ? bundle.CONSTANTS.END_CALL_REASONS.FAILED
        : reason === 'unanswered'
          ? bundle.CONSTANTS.END_CALL_REASONS.UNANSWERED
          : bundle.CONSTANTS.END_CALL_REASONS.REMOTE_ENDED;
    bundle.CallKeep.reportEndCallWithUUID(callId, reasonCode);
  } catch (error) {
    console.warn('[voip] endNativeCallKitCall failed (non-fatal):', error);
  }
}

// Best-effort sync of an App-UI-driven Accept back into CallKit's own call
// state (Gate requirement, section three) — tells CallKit this callId is
// answered without the user having used CallKit's own system UI. See
// contexts/call.tsx's `acceptCall`/shouldSyncAnswerIncomingCall for the
// once-per-call/echo-suppression rules; this function itself is a thin,
// never-throwing wrapper (matching endNativeCallKitCall's contract) around
// the installed package's synchronous `RNCallKeep.answerIncomingCall(uuid)`
// (confirmed void, not a Promise, in node_modules/react-native-callkeep/
// index.d.ts). A failure here must never be allowed to affect the server's
// already-confirmed ACCEPTED status — callers fire this without awaiting its
// outcome to touch any Call state.
export async function answerIncomingCallKitCall(callId: string): Promise<void> {
  const bundle = await getCallKeepModule();
  if (!bundle) return;
  try {
    bundle.CallKeep.answerIncomingCall(callId);
  } catch (error) {
    console.warn('[voip] answerIncomingCall failed (non-fatal):', error);
  }
}

// ---------------------------------------------------------------------------
// VoIP token registration (this task) — the coordinator calls
// registerVoipTokenOnce() AFTER subscribing its 'register'/'notification'/
// 'didLoadWithEvents' listeners (see components/ios-voip-callkit-
// coordinator.tsx), matching react-native-voip-push-notification's own
// README usage order. The pure decision helpers this depends on
// (isValidVoipToken, ApnsEnvironment mapping, VoipRegisterEvent dedup, token
// rotation/retry decisions) live in ./voipTokenRegistration instead of here
// — this file's top-level `import ... from 'react-native'` means it cannot
// be `require()`-d outside a React Native/Metro runtime, so anything that
// needs to stay unit-testable with plain node:assert (see
// voipTokenRegistration.test.js) must not live in this file. Re-exported
// here so callers only need one import path.
// ---------------------------------------------------------------------------

export {
  isValidVoipToken,
  mapApnsEnvironment,
  resolveApnsEnvironment,
  voipRegisterEventsEqual,
  resolveVoipTokenBindingDecision,
  shouldDeleteOldVoipToken,
  resolvePendingAfterUploadOutcome,
  shouldScheduleNextVoipTokenUploadAfterSettle,
  voipTokenMarkerMatches,
  type ApnsEnvironment,
  type VoipRegisterEvent,
  type VoipTokenUploadMarker,
} from './voipTokenRegistration';

let voipTokenRegistrationPromise: Promise<void> | null = null;

// Calls RNVoipPushNotificationManager.registerVoipToken() exactly once for
// the lifetime of the JS runtime — mirrors setupCallKeepOnce's module-level
// guard. The native module itself is also idempotent (a second native call
// just re-emits the last known token via the 'register' event instead of
// re-registering with PKPushRegistry — see the installed package's
// RNVoipPushNotificationManager.m `_isVoipRegistered` guard), so this is
// belt-and-suspenders against redundant JS-level calls across
// mount/remount. Never throws.
export function registerVoipTokenOnce(): Promise<void> {
  voipTokenRegistrationPromise ??= (async () => {
    const module = await getVoipPushModule();
    if (!module) return;
    try {
      module.registerVoipToken();
    } catch (error) {
      console.warn('[voip] registerVoipToken() failed (non-fatal):', error);
    }
  })();
  return voipTokenRegistrationPromise;
}
