import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  registerGlobals,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/react-native';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '@/design/system';

registerGlobals();

type Props = {
  serverUrl: string;
  token: string;
  partnerName: string;
  partnerAvatar: string;
  onEnd: () => void;
};

export function VoiceCallModal({ serverUrl, token, partnerName, partnerAvatar, onEnd }: Props) {
  return (
    <Modal visible animationType="slide" statusBarTranslucent>
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect
        audio
        video={false}
        onDisconnected={onEnd}
      >
        <CallScreen partnerName={partnerName} partnerAvatar={partnerAvatar} />
      </LiveKitRoom>
    </Modal>
  );
}

function CallScreen({ partnerName, partnerAvatar }: { partnerName: string; partnerAvatar: string }) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();
  const isConnected = connectionState === 'connected';
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isConnected]);

  const statusLabel =
    connectionState === 'connected'
      ? formatElapsed(elapsed)
      : connectionState === 'reconnecting'
      ? 'Reconnecting…'
      : 'Connecting…';

  const hangUp = async () => {
    await room.disconnect();
  };

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.statusLabel}>{statusLabel}</Text>

        <View style={styles.avatarWrap}>
          <Image source={{ uri: partnerAvatar }} style={styles.avatar} contentFit="cover" />
          {!isConnected && <View style={styles.pulseRing} />}
        </View>

        <Text style={styles.partnerName}>{partnerName}</Text>
        <Text style={styles.callHint}>
          {isConnected ? 'Voice call' : 'Calling…'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.controlBtn, !isMicrophoneEnabled && styles.controlBtnMuted]}
          onPress={toggleMute}
        >
          <Ionicons
            name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
            size={28}
            color={isMicrophoneEnabled ? '#FFFFFF' : '#FFFFFF'}
          />
        </Pressable>

        <Pressable style={styles.hangUpBtn} onPress={hangUp}>
          <Ionicons name="call" size={30} color="#FFFFFF" style={styles.hangUpIcon} />
        </Pressable>

        {/* spacer to keep hang-up centred */}
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
  pulseRing: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
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
