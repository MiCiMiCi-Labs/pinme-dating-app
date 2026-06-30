import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  registerGlobals,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
} from '@livekit/react-native';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '@/design/system';

registerGlobals();

type CallPhase = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'ended';

type Props = {
  serverUrl: string;
  token: string;
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
  onCallEnded?: (durationSeconds: number) => void;
};

export function VoiceCallModal({
  serverUrl,
  token,
  partnerName,
  partnerAvatar,
  onEnd,
  onCallEnded,
}: Props) {
  return (
    <Modal visible animationType="slide" statusBarTranslucent>
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect
        audio
        video={false}
      >
        <CallScreen
          partnerName={partnerName}
          partnerAvatar={partnerAvatar}
          onEnd={onEnd}
          onCallEnded={onCallEnded}
        />
      </LiveKitRoom>
    </Modal>
  );
}

function CallScreen({
  partnerName,
  partnerAvatar,
  onEnd,
  onCallEnded,
}: {
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
  onCallEnded?: (durationSeconds: number) => void;
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();
  const remoteParticipants = useRemoteParticipants();

  const hasPartner = remoteParticipants.length > 0;
  const prevHasPartner = useRef(false);

  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [elapsed, setElapsed] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const elapsedRef = useRef(0);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // Map LiveKit connection state → phase
  useEffect(() => {
    if (connectionState === 'reconnecting') {
      setPhase('reconnecting');
    } else if (connectionState === 'connected') {
      setPhase(hasPartner ? 'connected' : 'waiting');
    } else if (connectionState === 'disconnected') {
      // Show "ended" briefly, then close modal
      onCallEnded?.(elapsedRef.current);
      setPhase('ended');
      const timer = setTimeout(() => onEnd(), 1500);
      return () => clearTimeout(timer);
    }
  }, [connectionState]);

  // Detect partner join / leave
  useEffect(() => {
    if (connectionState !== 'connected') return;
    if (hasPartner && !prevHasPartner.current) {
      setPhase('connected');
      showBanner(`${partnerName} joined the call`);
    } else if (!hasPartner && prevHasPartner.current) {
      setPhase('waiting');
      showBanner(`${partnerName} left the call`);
    }
    prevHasPartner.current = hasPartner;
  }, [hasPartner]);

  // Timer only while partner is present
  useEffect(() => {
    if (phase !== 'connected') return;
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

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

  const hangUp = async () => {
    await room.disconnect();
    // connectionState will become 'disconnected', which triggers the effect above
  };

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  const statusLabel = (() => {
    switch (phase) {
      case 'connecting':   return 'Connecting…';
      case 'waiting':      return `Waiting for ${partnerName}…`;
      case 'connected':    return formatElapsed(elapsed);
      case 'reconnecting': return 'Reconnecting…';
      case 'ended':        return 'Call ended';
    }
  })();

  const callHint = (() => {
    switch (phase) {
      case 'connected': return 'Voice call';
      case 'ended':     return 'Call ended';
      default:          return 'Calling…';
    }
  })();

  const isPartnerActive = phase === 'connected';

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
          {!isPartnerActive && phase !== 'ended' && <View style={styles.pulseRing} />}
          {isPartnerActive && <View style={styles.greenDot} />}
        </View>

        <Text style={styles.partnerName}>{partnerName}</Text>
        <Text style={styles.callHint}>{callHint}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.controlBtn, !isMicrophoneEnabled && styles.controlBtnMuted]}
          onPress={toggleMute}
        >
          <Ionicons
            name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
            size={28}
            color="#FFFFFF"
          />
        </Pressable>

        <Pressable style={styles.hangUpBtn} onPress={hangUp}>
          <Ionicons name="call" size={30} color="#FFFFFF" style={styles.hangUpIcon} />
        </Pressable>

        <View style={[styles.controlBtn, { opacity: 0 }]} pointerEvents="none" />
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
