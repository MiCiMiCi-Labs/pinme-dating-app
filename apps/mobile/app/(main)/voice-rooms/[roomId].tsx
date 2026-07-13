import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  registerGlobals,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, photos, ProfileThumb } from '@/design/system';
import {
  closeVoiceRoom,
  getVoiceRoom,
  joinVoiceRoom,
  leaveVoiceRoom,
  muteVoiceRoomParticipant,
  type VoiceRoom,
  type VoiceRoomParticipant,
} from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import {
  markVoiceRoomNeedsRefresh,
  resetVoiceRoomState,
  setActiveVoiceRoom,
  setMicEnabled,
  setVoiceRoomMutedUsers,
} from '@/stores/voiceRoom.store';

registerGlobals();

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getParticipantPhoto(participant: VoiceRoomParticipant) {
  const primary = participant.user.photos.find(photo => photo.isPrimary) ?? participant.user.photos[0];
  return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : photos.redhead;
}

export default function VoiceRoomScreen() {
  const params = useLocalSearchParams<{ roomId?: string }>();
  const roomId = firstParam(params.roomId);
  const [room, setRoom] = useState<VoiceRoom | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const accessTokenRef = useRef<string | null>(null);

  const refreshRoom = useCallback(async () => {
    if (!roomId || !accessTokenRef.current) return;
    try {
      const { room: refreshedRoom } = await getVoiceRoom(accessTokenRef.current, roomId);
      setRoom(refreshedRoom);
    } catch {
      // Room may have been closed. Leave current UI state intact until LiveKit disconnects.
    }
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;
    setActiveVoiceRoom(roomId ?? null);

    async function join() {
      if (!roomId) {
        setError('Missing voice room id');
        setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Please log in again.');

        accessTokenRef.current = session.access_token;
        const joined = await joinVoiceRoom(session.access_token, roomId);
        if (cancelled) return;

        setRoom(joined.room);
        setServerUrl(joined.url);
        setToken(joined.token);
        setCurrentUserId(joined.participant.userId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to join voice room');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    join();

    return () => {
      cancelled = true;
      resetVoiceRoomState();
    };
  }, [roomId]);

  useEffect(() => {
    if (!room) return;
    setVoiceRoomMutedUsers(
      room.participants
        .filter(participant => participant.isMutedByHost)
        .map(participant => participant.userId)
    );
  }, [room]);

  useEffect(() => {
    if (!roomId || !accessTokenRef.current) return;
    const timer = setInterval(refreshRoom, 4000);
    return () => clearInterval(timer);
  }, [refreshRoom, roomId]);

  const isOwner = Boolean(room && currentUserId && room.ownerId === currentUserId);
  const myParticipant = useMemo(
    () => room?.participants.find(participant => participant.userId === currentUserId) ?? null,
    [currentUserId, room]
  );

  const handleLeave = async () => {
    if (!roomId || !accessTokenRef.current) {
      router.back();
      return;
    }

    if (isOwner) {
      Alert.alert('Close room?', 'As the host, closing is required before leaving this room.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close room',
          style: 'destructive',
          onPress: () => handleCloseRoom(),
        },
      ]);
      return;
    }

    await leaveVoiceRoom(accessTokenRef.current, roomId).catch(() => null);
    router.back();
  };

  const handleCloseRoom = async () => {
    if (!roomId || !accessTokenRef.current || closing) return;
    setClosing(true);
    try {
      await closeVoiceRoom(accessTokenRef.current, roomId);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close room');
    } finally {
      setClosing(false);
    }
  };

  const handleMuteParticipant = async (participant: VoiceRoomParticipant) => {
    if (!roomId || !accessTokenRef.current || !room || participant.userId === room.ownerId) return;

    try {
      const { room: updatedRoom } = await muteVoiceRoomParticipant(
        accessTokenRef.current,
        roomId,
        participant.userId,
        !participant.isMutedByHost
      );
      setRoom(updatedRoom);
      markVoiceRoomNeedsRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update participant');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && (!room || !serverUrl || !token)) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!room || !serverUrl || !token) return null;

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect
      audio
      video={false}
      onDisconnected={() => null}
    >
      <VoiceRoomStage
        room={room}
        currentUserId={currentUserId}
        isOwner={isOwner}
        myParticipant={myParticipant}
        error={error}
        closing={closing}
        onBack={handleLeave}
        onCloseRoom={handleCloseRoom}
        onMuteParticipant={handleMuteParticipant}
      />
    </LiveKitRoom>
  );
}

function VoiceRoomStage({
  room,
  currentUserId,
  isOwner,
  myParticipant,
  error,
  closing,
  onBack,
  onCloseRoom,
  onMuteParticipant,
}: {
  room: VoiceRoom;
  currentUserId: string | null;
  isOwner: boolean;
  myParticipant: VoiceRoomParticipant | null;
  error: string | null;
  closing: boolean;
  onBack: () => void;
  onCloseRoom: () => void;
  onMuteParticipant: (participant: VoiceRoomParticipant) => void;
}) {
  const roomContext = useRoomContext();
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const mutedByHost = Boolean(myParticipant?.isMutedByHost);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  useEffect(() => {
    if (mutedByHost && isMicrophoneEnabled) {
      localParticipant.setMicrophoneEnabled(false);
    }
  }, [isMicrophoneEnabled, localParticipant, mutedByHost]);

  useEffect(() => {
    setMicEnabled(Boolean(isMicrophoneEnabled && !mutedByHost));
  }, [isMicrophoneEnabled, mutedByHost]);

  const toggleMic = async () => {
    if (mutedByHost) return;
    const nextEnabled = !isMicrophoneEnabled;
    setMicEnabled(nextEnabled);
    await localParticipant.setMicrophoneEnabled(nextEnabled);
  };

  const leave = async () => {
    await roomContext.disconnect();
    onBack();
  };

  const statusLabel =
    connectionState === 'connected'
      ? 'Live now'
      : connectionState === 'reconnecting'
        ? 'Reconnecting...'
        : 'Connecting...';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={leave}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{room.name}</Text>
          <Text style={styles.roomId}>ID {room.id}</Text>
        </View>
        {isOwner ? (
          <Pressable style={styles.closeButton} onPress={onCloseRoom} disabled={closing}>
            {closing ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="power" size={20} color="#FFFFFF" />}
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>

      <View style={styles.statusRow}>
        <View style={styles.liveDot} />
        <Text style={styles.statusText}>{statusLabel}</Text>
        {room.tags.map(tag => (
          <Text key={`${room.id}-${tag}`} style={styles.tag}>{tag}</Text>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.stage} showsVerticalScrollIndicator={false}>
        {room.participants.map(participant => {
          const isMe = participant.userId === currentUserId;
          const canMute = isOwner && !isMe && participant.userId !== room.ownerId;
          return (
            <View key={participant.id} style={styles.seat}>
              <View style={[styles.avatarRing, participant.isMutedByHost && styles.avatarMuted]}>
                <ProfileThumb uri={getParticipantPhoto(participant)} size={70} />
                {participant.isMutedByHost ? (
                  <View style={styles.muteBadge}>
                    <Ionicons name="mic-off" size={14} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
              <Text style={styles.participantName} numberOfLines={1}>
                {participant.user.name}{isMe ? ' (You)' : ''}
              </Text>
              {participant.userId === room.ownerId ? (
                <Text style={styles.hostLabel}>Host</Text>
              ) : canMute ? (
                <Pressable style={styles.muteButton} onPress={() => onMuteParticipant(participant)}>
                  <Text style={styles.muteButtonText}>
                    {participant.isMutedByHost ? 'Unmute' : 'Mute'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.hostLabel}>{participant.isMutedByHost ? 'Muted' : 'Listener'}</Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.controls}>
        <Pressable
          style={[styles.micControl, (!isMicrophoneEnabled || mutedByHost) && styles.micControlMuted]}
          onPress={toggleMic}
          disabled={mutedByHost}
        >
          <Ionicons name={isMicrophoneEnabled && !mutedByHost ? 'mic' : 'mic-off'} size={28} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.controlHint}>
          {mutedByHost ? 'Host muted your mic' : isMicrophoneEnabled ? 'Mic on' : 'Mic off'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  roomId: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 24,
    marginTop: 18,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  statusText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginRight: 4,
  },
  tag: {
    minWidth: 58,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFF0F3',
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 9,
    paddingVertical: 8,
    textAlign: 'center',
  },
  errorText: {
    color: colors.primary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 24,
  },
  stage: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 150,
  },
  seat: {
    width: '30%',
    alignItems: 'center',
    gap: 8,
    minHeight: 142,
  },
  avatarRing: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  avatarMuted: {
    borderColor: colors.grayIcon,
  },
  muteBadge: {
    position: 'absolute',
    right: 4,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    maxWidth: 92,
  },
  hostLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  muteButton: {
    borderRadius: 999,
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  muteButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 34,
    alignItems: 'center',
    gap: 10,
  },
  micControl: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micControlMuted: {
    backgroundColor: '#6B7280',
  },
  controlHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
