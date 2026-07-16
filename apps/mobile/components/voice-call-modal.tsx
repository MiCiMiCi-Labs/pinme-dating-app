import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  registerGlobals,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/react-native';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import { MediaDeviceFailure } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/design/system';
import { showToast } from '@/stores/toast.store';
import type { CallPhase } from '@/contexts/call';
import type { CallFailureReason, CallSummary, LiveKitCredentials } from '@/lib/api';

registerGlobals();

// LiveKit's own initial-connect timeouts (peerConnectionTimeout /
// websocketTimeout) default to 15s and normally surface via onError first.
// This is a backstop for the case where neither onConnected nor onError
// ever fires (e.g. the JS bridge itself hangs) — see LiveKitConnectionSection.
const CONNECTION_TIMEOUT_MS = 20_000;

// How long to wait after the partner's participant disappears from the
// LiveKit room before confirming the Call's real server-side state — a
// brief network blip on their end shouldn't immediately trigger a fail
// report; see ConnectedCallScreen's hasPartner effect.
const PARTNER_LEFT_GRACE_MS = 8_000;

// AudioSession.selectAudioOutput's accepted deviceIds differ by platform
// (see @livekit/react-native's AudioSession.d.ts): Android exposes real
// "speaker"/"earpiece" device ids, but iOS — an OS limitation documented in
// that same type declaration — only ever exposes "default" and
// "force_speaker". There is no true iOS "earpiece" selector in this API;
// "default" merely lets iOS's own AVAudioSession routing decide (which,
// without other devices connected, effectively means the receiver/earpiece
// under the playAndRecord category LiveKit configures).
const SPEAKER_OUTPUT_ID = Platform.OS === 'ios' ? 'force_speaker' : 'speaker';
const EARPIECE_OUTPUT_ID = Platform.OS === 'ios' ? 'default' : 'earpiece';

// Driven entirely by CallProvider's state machine (docs/private-voice-calling-spec.md
// "移动端架构 > 全局 CallProvider" / "十二、通话 UI"). This component owns none of
// the ringing/accepted/ended lifecycle itself — it only renders `phase` and
// forwards user actions upward. Before `livekit` is issued (pre-ACCEPTED) it
// never mounts LiveKitRoom, so the mic/media session genuinely cannot start
// before the callee has accepted.
type Props = {
  call: CallSummary;
  role: 'caller' | 'callee';
  livekit: LiveKitCredentials | null;
  phase: CallPhase;
  partnerName: string;
  partnerAvatar: string;
  onCancel: () => void;
  onEnd: () => void;
  onMediaConnected: () => void;
  onMediaDisconnected: () => void;
  onReportFailure: (reason: CallFailureReason) => void;
  onConfirmOrFail: () => void;
};

export function VoiceCallModal({
  call,
  role,
  livekit,
  phase,
  partnerName,
  partnerAvatar,
  onCancel,
  onEnd,
  onMediaConnected,
  onMediaDisconnected,
  onReportFailure,
  onConfirmOrFail,
}: Props) {
  return (
    <Modal visible animationType="slide" statusBarTranslucent>
      {livekit ? (
        <MicPreflightGate
          livekit={livekit}
          call={call}
          partnerName={partnerName}
          partnerAvatar={partnerAvatar}
          onEnd={onEnd}
          onMediaConnected={onMediaConnected}
          onMediaDisconnected={onMediaDisconnected}
          onReportFailure={onReportFailure}
          onConfirmOrFail={onConfirmOrFail}
        />
      ) : (
        <PreConnectScreen
          role={role}
          phase={phase}
          partnerName={partnerName}
          partnerAvatar={partnerAvatar}
          onCancel={onCancel}
        />
      )}
    </Modal>
  );
}

// Runs a microphone-permission preflight before ever mounting `<LiveKitRoom
// audio>` — RINGING/ACCEPTED never touch the microphone; only once
// `livekit` credentials exist (this component only renders then) do we ask,
// and only a granted result proceeds to actually connect. Denied (or an
// unexpected error checking permission) reports MICROPHONE_DENIED to the
// server instead of ever attempting to connect — the Call's FAILED status
// coming back down through CallProvider is what ultimately flips `phase`,
// not a local-only state flag.
type MicPermissionState = 'checking' | 'granted' | 'denied';

function MicPreflightGate({
  livekit,
  call,
  partnerName,
  partnerAvatar,
  onEnd,
  onMediaConnected,
  onMediaDisconnected,
  onReportFailure,
  onConfirmOrFail,
}: {
  livekit: LiveKitCredentials;
  call: CallSummary;
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
  onMediaConnected: () => void;
  onMediaDisconnected: () => void;
  onReportFailure: (reason: CallFailureReason) => void;
  onConfirmOrFail: () => void;
}) {
  const [permission, setPermission] = useState<MicPermissionState>('checking');
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const { granted } = await Audio.requestPermissionsAsync();
        if (cancelled) return;
        if (granted) {
          setPermission('granted');
        } else {
          setPermission('denied');
          onReportFailure('MICROPHONE_DENIED');
        }
      } catch {
        // An unexpected error from the permission API itself — cannot
        // proceed either way. Report it under the same reason rather than
        // leaving the UI stuck on "checking" forever.
        if (cancelled) return;
        setPermission('denied');
        onReportFailure('MICROPHONE_DENIED');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onReportFailure]);

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.statusLabel}>Microphone needed</Text>
          <View style={styles.avatarWrap}>
            <Image source={{ uri: partnerAvatar }} style={[styles.avatar, styles.avatarDim]} contentFit="cover" />
          </View>
          <Text style={styles.partnerName}>{partnerName}</Text>
          <Text style={styles.callHint}>
            Voice calls need microphone access. Enable it in Settings to make calls.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permission === 'checking') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <Text style={styles.statusLabel}>Connecting…</Text>
          <View style={styles.avatarWrap}>
            <Image source={{ uri: partnerAvatar }} style={[styles.avatar, styles.avatarDim]} contentFit="cover" />
            <View style={styles.pulseRing} />
          </View>
          <Text style={styles.partnerName}>{partnerName}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <LiveKitConnectionSection
      livekit={livekit}
      call={call}
      partnerName={partnerName}
      partnerAvatar={partnerAvatar}
      onEnd={onEnd}
      onMediaConnected={onMediaConnected}
      onMediaDisconnected={onMediaDisconnected}
      onReportFailure={onReportFailure}
      onConfirmOrFail={onConfirmOrFail}
    />
  );
}

// Owns the actual `<LiveKitRoom>` mount and its connection-lifecycle
// callbacks. Mounts exactly once per call (MicPreflightGate only reaches
// here once, after permission is granted), so refs here are correctly
// scoped to a single connection attempt.
function LiveKitConnectionSection({
  livekit,
  call,
  partnerName,
  partnerAvatar,
  onEnd,
  onMediaConnected,
  onMediaDisconnected,
  onReportFailure,
  onConfirmOrFail,
}: {
  livekit: LiveKitCredentials;
  call: CallSummary;
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
  onMediaConnected: () => void;
  onMediaDisconnected: () => void;
  onReportFailure: (reason: CallFailureReason) => void;
  onConfirmOrFail: () => void;
}) {
  const hasConnectedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (!hasConnectedRef.current) onConfirmOrFail();
    }, CONNECTION_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [onConfirmOrFail]);

  const handleConnected = useCallback(() => {
    hasConnectedRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleError = useCallback(() => {
    // A room-level error while we were already live is most often a
    // transient blip that LiveKit's own reconnect logic will resolve on its
    // own (connectionState will move to 'reconnecting' and either recover
    // or eventually fire onDisconnected below). Only treat this as severe
    // if we never got connected in the first place.
    if (!hasConnectedRef.current) onConfirmOrFail();
  }, [onConfirmOrFail]);

  const handleDisconnected = useCallback(() => {
    onConfirmOrFail();
  }, [onConfirmOrFail]);

  // MediaDeviceFailure (see livekit-client's room/errors.d.ts) is a
  // definitive local signal about the audio device itself, not a
  // connectivity blip — reported directly rather than routed through
  // confirmCallOrFail's "GET first" reconciliation, the same way
  // MicPreflightGate reports a denied mic permission directly. The server's
  // FAILED status (set via the same reportMediaFailure -> POST /fail path
  // used everywhere else) remains the source of truth either way.
  const handleMediaDeviceFailure = useCallback(
    (failure?: MediaDeviceFailure) => {
      if (failure === MediaDeviceFailure.PermissionDenied) {
        onReportFailure('MICROPHONE_DENIED');
        return;
      }
      // NotFound (no mic hardware), DeviceInUse (held by another app),
      // Other, or unknown (undefined) — the call cannot meaningfully
      // continue without a working audio device. LIVEKIT_CONNECTION_FAILED
      // is the closest whitelisted reason among the three the backend
      // accepts (see POST /:callId/fail).
      onReportFailure('LIVEKIT_CONNECTION_FAILED');
    },
    [onReportFailure]
  );

  return (
    <LiveKitRoom
      serverUrl={livekit.url}
      token={livekit.token}
      connect
      audio
      video={false}
      onConnected={handleConnected}
      onError={handleError}
      onDisconnected={handleDisconnected}
      onMediaDeviceFailure={handleMediaDeviceFailure}
    >
      <ConnectedCallScreen
        call={call}
        partnerName={partnerName}
        partnerAvatar={partnerAvatar}
        onEnd={onEnd}
        onMediaConnected={onMediaConnected}
        onMediaDisconnected={onMediaDisconnected}
        onConfirmOrFail={onConfirmOrFail}
      />
    </LiveKitRoom>
  );
}

// Rendered from the moment a call is created (caller: outgoingRinging) or
// accepted-but-not-yet-tokened (callee: accepting) until ACCEPTED status
// actually yields LiveKit credentials. No microphone, no LiveKit connection.
function PreConnectScreen({
  role,
  phase,
  partnerName,
  partnerAvatar,
  onCancel,
}: {
  role: 'caller' | 'callee';
  phase: CallPhase;
  partnerName: string;
  partnerAvatar: string;
  onCancel: () => void;
}) {
  const statusLabel = (() => {
    switch (phase) {
      case 'outgoingRinging':
        return 'Calling…';
      case 'accepting':
      case 'connecting':
        return 'Connecting…';
      case 'ended':
        return 'Call ended';
      case 'failed':
        return 'Call failed';
      default:
        return 'Calling…';
    }
  })();

  const showCancel = role === 'caller' && phase === 'outgoingRinging';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.statusLabel}>{statusLabel}</Text>

        <View style={styles.avatarWrap}>
          <Image source={{ uri: partnerAvatar }} style={[styles.avatar, styles.avatarDim]} contentFit="cover" />
          {phase !== 'ended' && phase !== 'failed' && <View style={styles.pulseRing} />}
        </View>

        <Text style={styles.partnerName}>{partnerName}</Text>
        <Text style={styles.callHint}>Voice call</Text>
      </View>

      <View style={styles.controls}>
        <View style={[styles.controlBtn, { opacity: 0 }]} pointerEvents="none" />
        {showCancel ? (
          <Pressable style={styles.hangUpBtn} onPress={onCancel}>
            <Ionicons name="call" size={30} color="#FFFFFF" style={styles.hangUpIcon} />
          </Pressable>
        ) : (
          <View style={[styles.hangUpBtn, { opacity: 0 }]} pointerEvents="none" />
        )}
        <View style={[styles.controlBtn, { opacity: 0 }]} pointerEvents="none" />
      </View>
    </SafeAreaView>
  );
}

function ConnectedCallScreen({
  call,
  partnerName,
  partnerAvatar,
  onEnd,
  onMediaConnected,
  onMediaDisconnected,
  onConfirmOrFail,
}: {
  call: CallSummary;
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
  onMediaConnected: () => void;
  onMediaDisconnected: () => void;
  onConfirmOrFail: () => void;
}) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();
  const remoteParticipants = useRemoteParticipants();

  const hasPartner = remoteParticipants.length > 0;
  // 'signalReconnecting' is a sub-state of reconnection (see livekit-client's
  // ConnectionState enum) — treated the same as 'reconnecting' here.
  const isReconnecting = connectionState === 'reconnecting' || connectionState === 'signalReconnecting';
  const isConnecting = connectionState === 'connecting';

  const [elapsed, setElapsed] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const prevHasPartner = useRef(false);
  const partnerLeftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the partner has ever been seen in the room at all — distinguishes
  // "never joined" (handled below, once we're locally connected) from
  // "joined then left" (the existing partnerLeftTimerRef grace above).
  const hasEverHadPartnerRef = useRef(false);
  const partnerNeverJoinedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [speakerToggling, setSpeakerToggling] = useState(false);

  useEffect(() => {
    if (connectionState === 'connected') onMediaConnected();
    if (connectionState === 'reconnecting' || connectionState === 'signalReconnecting') onMediaDisconnected();
  }, [connectionState, onMediaConnected, onMediaDisconnected]);

  useEffect(() => {
    if (hasPartner) hasEverHadPartnerRef.current = true;
  }, [hasPartner]);

  useEffect(() => {
    if (hasPartner && !prevHasPartner.current) {
      showBanner(`${partnerName} joined the call`);
      if (partnerLeftTimerRef.current) {
        clearTimeout(partnerLeftTimerRef.current);
        partnerLeftTimerRef.current = null;
      }
    } else if (!hasPartner && prevHasPartner.current) {
      showBanner(`${partnerName} left the call`);
      // Don't just show a banner and wait indefinitely — the partner may
      // simply be reconnecting (a network blip on their end shouldn't
      // immediately end the call). After a short grace period, confirm the
      // Call's real server-side state instead of leaving the UI stuck; if
      // they're back in the room before then, the branch above already
      // cleared this timer.
      if (partnerLeftTimerRef.current) clearTimeout(partnerLeftTimerRef.current);
      partnerLeftTimerRef.current = setTimeout(() => {
        partnerLeftTimerRef.current = null;
        onConfirmOrFail();
      }, PARTNER_LEFT_GRACE_MS);
    }
    prevHasPartner.current = hasPartner;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPartner]);

  // "Partner never joined" grace: distinct from the "joined then left" timer
  // above. Only starts once *we* are locally connected (never before — a
  // partner can't reasonably be expected to be in the room while our own
  // connection isn't even up yet) and only for a partner that has never
  // shown up at all; re-runs (via the effect dependency on hasPartner) if
  // a brief participant-list update happens to flip hasPartner momentarily,
  // clearing/restarting the grace rather than failing on that alone.
  useEffect(() => {
    if (connectionState !== 'connected') return;
    if (hasPartner) return;
    if (hasEverHadPartnerRef.current) return; // "left after joining" — the other timer covers this

    partnerNeverJoinedTimerRef.current = setTimeout(() => {
      partnerNeverJoinedTimerRef.current = null;
      onConfirmOrFail();
    }, PARTNER_LEFT_GRACE_MS);

    return () => {
      if (partnerNeverJoinedTimerRef.current) {
        clearTimeout(partnerNeverJoinedTimerRef.current);
        partnerNeverJoinedTimerRef.current = null;
      }
    };
  }, [connectionState, hasPartner, onConfirmOrFail]);

  useEffect(() => {
    return () => {
      if (partnerLeftTimerRef.current) clearTimeout(partnerLeftTimerRef.current);
      if (partnerNeverJoinedTimerRef.current) clearTimeout(partnerNeverJoinedTimerRef.current);
    };
  }, []);

  // Duration is computed from the server's answeredAt, not from when this
  // screen happened to mount, so it reads correctly across app
  // backgrounding and stays consistent between caller and callee.
  useEffect(() => {
    if (!call.answeredAt) return;
    const answeredAtMs = new Date(call.answeredAt).getTime();

    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - answeredAtMs) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [call.answeredAt]);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  const showBanner = (message: string) => {
    setBanner(message);
    bannerOpacity.setValue(1);
    setTimeout(() => {
      Animated.timing(bannerOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setBanner(null));
    }, 2500);
  };

  const hangUp = () => {
    onEnd();
  };

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  // AudioSession.selectAudioOutput/getAudioOutputs — see the SPEAKER_OUTPUT_ID
  // / EARPIECE_OUTPUT_ID comment above for the iOS "no true earpiece"
  // limitation. On any failure (including the target output not being in
  // getAudioOutputs()'s list, e.g. no earpiece hardware) the toggle keeps
  // its prior state and surfaces a toast instead of silently no-op'ing or
  // ending the call.
  const toggleSpeaker = async () => {
    if (speakerToggling) return;
    const nextOn = !speakerOn;
    const targetOutput = nextOn ? SPEAKER_OUTPUT_ID : EARPIECE_OUTPUT_ID;

    setSpeakerToggling(true);
    try {
      const outputs = await AudioSession.getAudioOutputs();
      if (!outputs.includes(targetOutput)) {
        showToast('That audio output is not available on this device', 'error');
        return;
      }
      await AudioSession.selectAudioOutput(targetOutput);
      setSpeakerOn(nextOn);
    } catch {
      showToast('Could not switch audio output', 'error');
    } finally {
      setSpeakerToggling(false);
    }
  };

  const statusLabel = isConnecting ? 'Connecting…' : isReconnecting ? 'Reconnecting…' : formatElapsed(elapsed);
  const isPartnerActive = hasPartner && !isReconnecting;

  return (
    <SafeAreaView style={styles.screen}>
      {banner && (
        <Animated.View style={[styles.banner, { opacity: bannerOpacity }]}>
          <Text style={styles.bannerText}>{banner}</Text>
        </Animated.View>
      )}

      <View style={styles.content}>
        <Text style={styles.statusLabel}>{statusLabel}</Text>

        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: partnerAvatar }}
            style={[styles.avatar, !isPartnerActive && styles.avatarDim]}
            contentFit="cover"
          />
          {isPartnerActive && <View style={styles.activeRing} />}
          {!isPartnerActive && <View style={styles.pulseRing} />}
          {isPartnerActive && <View style={styles.greenDot} />}
        </View>

        <Text style={styles.partnerName}>{partnerName}</Text>
        <Text style={styles.callHint}>Voice call</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.controlBtn, !isMicrophoneEnabled && styles.controlBtnMuted]}
          onPress={toggleMute}
        >
          <Ionicons name={isMicrophoneEnabled ? 'mic' : 'mic-off'} size={28} color="#FFFFFF" />
        </Pressable>

        <Pressable style={styles.hangUpBtn} onPress={hangUp}>
          <Ionicons name="call" size={30} color="#FFFFFF" style={styles.hangUpIcon} />
        </Pressable>

        <Pressable
          style={[styles.controlBtn, !speakerOn && styles.controlBtnMuted]}
          onPress={toggleSpeaker}
          disabled={speakerToggling}
        >
          <Ionicons name={speakerOn ? 'volume-high' : 'volume-low'} size={26} color="#FFFFFF" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'space-between',
  },
  banner: {
    position: 'absolute',
    top: 60,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 10,
    alignItems: 'center',
  },
  bannerText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  avatarWrap: {
    width: 148,
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  avatarDim: {
    opacity: 0.35,
  },
  activeRing: {
    position: 'absolute',
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 2.5,
    borderColor: '#22C55E',
  },
  pulseRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  greenDot: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#22C55E',
    borderWidth: 2.5,
    borderColor: '#111827',
  },
  partnerName: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 8,
  },
  callHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
  },
  controlBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnMuted: {
    backgroundColor: colors.primary,
  },
  hangUpBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangUpIcon: {
    transform: [{ rotate: '135deg' }],
  },
});
