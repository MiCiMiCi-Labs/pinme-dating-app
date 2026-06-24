import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, IconButton, photos, ProfileThumb } from '@/design/system';
import {
  getCurrentAppUser,
  getMessages,
  markMessagesRead,
  sendImageMessage,
  sendMessage,
  sendVideoMessage,
  sendVoiceMessage,
  type ChatMessage,
  type ReplyPreview,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getReplyPreviewText(msg: ReplyPreview): string {
  switch (msg.messageType) {
    case 'IMAGE': return '📷 Photo';
    case 'VIDEO': return '🎬 Video';
    case 'VOICE': return '🎤 Voice message';
    case 'GIF': return '🎞 GIF';
    default: return msg.content.length > 60 ? `${msg.content.slice(0, 60)}…` : msg.content;
  }
}

type RealtimeMessageRow = {
  id: string;
  match_id: string;
  sender_id: string | null;
  content: string;
  message_type: ChatMessage['messageType'];
  duration_sec: number | null;
  reply_to_id: string | null;
  is_read: boolean;
  created_at: string;
};

function mapRealtimeMessage(row: RealtimeMessageRow, knownMessages: ChatMessage[] = []): ChatMessage {
  let replyTo: ReplyPreview | null = null;
  if (row.reply_to_id) {
    const parent = knownMessages.find(m => m.id === row.reply_to_id);
    if (parent) {
      replyTo = { id: parent.id, content: parent.content, messageType: parent.messageType, sender: parent.sender };
    }
  }
  return {
    id: row.id,
    matchId: row.match_id,
    senderId: row.sender_id,
    content: row.content,
    messageType: row.message_type,
    durationSec: row.duration_sec ?? null,
    isRead: row.is_read,
    createdAt: row.created_at,
    sender: null,
    replyTo,
  };
}

function mergeMessage(current: ChatMessage[], incoming: ChatMessage) {
  const existingIndex = current.findIndex(message => message.id === incoming.id);

  if (existingIndex === -1) {
    return [...current, incoming].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  const next = [...current];
  const existing = next[existingIndex];
  next[existingIndex] = {
    ...existing,
    ...incoming,
    sender: incoming.sender ?? existing.sender,
    replyTo: incoming.replyTo ?? existing.replyTo,
  };
  return next;
}

export default function ChatRoomScreen() {
  const params = useLocalSearchParams<{
    matchId?: string;
    name?: string;
    photoUrl?: string;
  }>();
  const matchId = firstParam(params.matchId);
  const name = firstParam(params.name) ?? 'Chat';
  const photoUrl = firstParam(params.photoUrl) ?? photos.redhead;

  const scrollRef = useRef<ScrollView>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const videoRef = useRef<Video | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [videoPlayer, setVideoPlayer] = useState<string | null>(null);

  const loadThread = useCallback(async (showLoading = true) => {
    if (!matchId) {
      setError('Missing match id');
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }
    setError(current => (current === 'Realtime connection failed. Refreshing messages.' ? null : current));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const [{ user }, { messages: loadedMessages }] = await Promise.all([
        getCurrentAppUser(session.access_token),
        getMessages(session.access_token, matchId),
      ]);

      setCurrentUserId(user.id);
      setMessages(loadedMessages);
      await markMessagesRead(session.access_token, matchId).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      if (showLoading) {
        setLoading(false);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
      }
    }
  }, [matchId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!matchId) return;

    const activeMatchId = matchId;
    let closed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function startRealtime() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || closed) return;

      supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`messages:${activeMatchId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `match_id=eq.${activeMatchId}`,
          },
          (payload) => {
            const row = payload.new as RealtimeMessageRow;
            setMessages(current => mergeMessage(current, mapRealtimeMessage(row, current)));
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

            // If the replied-to message isn't loaded locally, do a silent refresh to get replyTo data
            if (row.reply_to_id && !messagesRef.current.some(m => m.id === row.reply_to_id)) {
              loadThread(false);
            }

            const activeUserId = currentUserIdRef.current;
            if (activeUserId && row.sender_id && row.sender_id !== activeUserId) {
              supabase.auth.getSession().then(({ data: { session } }) => {
                if (session?.access_token) {
                  markMessagesRead(session.access_token, activeMatchId).catch(() => null);
                }
              });
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages',
            filter: `match_id=eq.${activeMatchId}`,
          },
          (payload) => {
            const row = payload.new as RealtimeMessageRow;
            setMessages(current => mergeMessage(current, mapRealtimeMessage(row, current)));
          }
        )
        .subscribe((status) => {
          if (closed) return;

          if (status === 'SUBSCRIBED') {
            setError(null);
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }

          if (status === 'CHANNEL_ERROR') {
            setError('Realtime connection failed. Refreshing messages.');
            if (!pollingRef.current) {
              pollingRef.current = setInterval(() => {
                loadThread(false);
              }, 4000);
            }
          }
        });
    }

    startRealtime();

    return () => {
      closed = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [loadThread, matchId]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !matchId || sending) return;

    const pendingReplyTo = replyTo;
    const tempId = `pending-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      matchId,
      senderId: currentUserId,
      content,
      messageType: 'TEXT',
      durationSec: null,
      isRead: false,
      createdAt: new Date().toISOString(),
      sender: null,
      replyTo: pendingReplyTo ? {
        id: pendingReplyTo.id,
        content: pendingReplyTo.content,
        messageType: pendingReplyTo.messageType,
        sender: pendingReplyTo.sender,
      } : null,
    };

    setDraft('');
    setReplyTo(null);
    setSending(true);
    setError(null);
    setMessages(current => mergeMessage(current, optimisticMessage));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = await sendMessage(session.access_token, matchId, content, pendingReplyTo?.id);
      setMessages(current => mergeMessage(current.filter(item => item.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setDraft(content);
      setMessages(current => current.filter(item => item.id !== tempId));
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setError('Microphone permission is required to send voice messages.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setRecordingSec(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSec(s => s + 1);
      }, 1000);
    } catch (_) {
      setError('Could not start recording.');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingRef.current || !matchId) return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);

    const duration = recordingSec;
    const rec = recordingRef.current;
    const pendingReplyTo = replyTo;
    recordingRef.current = null;

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (!uri) return;

      setReplyTo(null);
      setSending(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = await sendVoiceMessage(
        session.access_token, matchId, uri, duration, pendingReplyTo?.id
      );
      setMessages(current => mergeMessage(current, message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send voice message');
    } finally {
      setSending(false);
      setRecordingSec(0);
    }
  };

  const handlePlayVoice = async (messageId: string, url: string) => {
    if (playingId === messageId) {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
      setPlayingId(null);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingId(null);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
          }
        }
      );
      soundRef.current = sound;
      setPlayingId(messageId);
    } catch (_) {
      setError('Could not play voice message.');
    }
  };

  const handlePickMedia = async () => {
    if (sending || !matchId) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Media library permission is required to send photos and videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    const durationSec = isVideo ? Math.round((asset.duration ?? 0) / 1000) : null;
    const pendingReplyTo = replyTo;

    const tempId = `pending-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      matchId,
      senderId: currentUserId,
      content: asset.uri,
      messageType: isVideo ? 'VIDEO' : 'IMAGE',
      durationSec,
      isRead: false,
      createdAt: new Date().toISOString(),
      sender: null,
      replyTo: pendingReplyTo ? {
        id: pendingReplyTo.id,
        content: pendingReplyTo.content,
        messageType: pendingReplyTo.messageType,
        sender: pendingReplyTo.sender,
      } : null,
    };

    setReplyTo(null);
    setSending(true);
    setError(null);
    setMessages(current => mergeMessage(current, optimisticMessage));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = isVideo
        ? await sendVideoMessage(session.access_token, matchId, asset.uri, mimeType, durationSec ?? 0, pendingReplyTo?.id)
        : await sendImageMessage(session.access_token, matchId, asset.uri, mimeType, pendingReplyTo?.id);

      setMessages(current => mergeMessage(current.filter(m => m.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setMessages(current => current.filter(m => m.id !== tempId));
      setError(err instanceof Error ? err.message : 'Failed to send media');
    } finally {
      setSending(false);
    }
  };

  const handleCloseVideo = async () => {
    try { await videoRef.current?.stopAsync(); } catch { /* ignore */ }
    setVideoPlayer(null);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.replace('/(main)/chats')} />
          <View style={styles.personRow}>
            <ProfileThumb uri={photoUrl} size={54} />
            <View>
              <Text style={styles.title} numberOfLines={1}>{name}</Text>
              <View style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.online}>Matched</Text>
              </View>
            </View>
          </View>
          <IconButton icon="refresh-outline" onPress={loadThread} />
        </View>

        <View style={styles.dayRow}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>Messages</Text>
          <View style={styles.dayLine} />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.thread}
            contentContainerStyle={messages.length ? styles.threadContent : styles.emptyThread}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length ? (
              messages.map(message => {
                if (message.messageType === 'SYSTEM') {
                  return (
                    <View key={message.id} style={styles.systemMessage}>
                      <Text style={styles.systemMessageText}>{message.content}</Text>
                    </View>
                  );
                }

                const mine = message.senderId === currentUserId;

                if (message.messageType === 'VOICE') {
                  const isPlaying = playingId === message.id;
                  const dur = message.durationSec ?? 0;
                  const durLabel = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
                  return (
                    <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                      <Pressable
                        style={[styles.bubble, styles.voiceBubble, mine ? styles.bubbleMine : styles.bubbleOther]}
                        onPress={() => handlePlayVoice(message.id, message.content)}
                        onLongPress={() => setReplyTo(message)}
                      >
                        {message.replyTo && (
                          <View style={styles.replyQuote}>
                            <View style={styles.replyQuoteAccent} />
                            <Text style={styles.replyQuoteText} numberOfLines={1}>{getReplyPreviewText(message.replyTo)}</Text>
                          </View>
                        )}
                        <View style={styles.voiceRow}>
                          <Ionicons
                            name={isPlaying ? 'pause-circle' : 'play-circle'}
                            size={32}
                            color={mine ? colors.primary : colors.text}
                          />
                          <View style={styles.voiceInfo}>
                            <View style={styles.voiceWave}>
                              {Array.from({ length: 16 }).map((_, i) => (
                                <View
                                  key={i}
                                  style={[
                                    styles.voiceBar,
                                    { height: 4 + (i % 4) * 4 },
                                    isPlaying && styles.voiceBarActive,
                                  ]}
                                />
                              ))}
                            </View>
                            <Text style={styles.voiceDuration}>{durLabel}</Text>
                          </View>
                        </View>
                      </Pressable>
                      <Text style={[styles.messageTime, mine && styles.timeMine]}>
                        {formatMessageTime(message.createdAt)}
                        {mine ? `  ${message.isRead ? '✓✓' : '✓'}` : ''}
                      </Text>
                    </View>
                  );
                }

                if (message.messageType === 'IMAGE') {
                  return (
                    <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                      {message.replyTo && (
                        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, styles.replyQuoteWrapper]}>
                          <View style={styles.replyQuote}>
                            <View style={styles.replyQuoteAccent} />
                            <Text style={styles.replyQuoteText} numberOfLines={1}>{getReplyPreviewText(message.replyTo)}</Text>
                          </View>
                        </View>
                      )}
                      <Pressable
                        onPress={() => setImageViewer(message.content)}
                        onLongPress={() => setReplyTo(message)}
                      >
                        <Image
                          source={{ uri: message.content }}
                          style={styles.imageBubble}
                          contentFit="cover"
                        />
                      </Pressable>
                      <Text style={[styles.messageTime, mine && styles.timeMine]}>
                        {formatMessageTime(message.createdAt)}
                        {mine ? `  ${message.isRead ? '✓✓' : '✓'}` : ''}
                      </Text>
                    </View>
                  );
                }

                if (message.messageType === 'VIDEO') {
                  const dur = message.durationSec ?? 0;
                  const durLabel = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
                  return (
                    <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                      {message.replyTo && (
                        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, styles.replyQuoteWrapper]}>
                          <View style={styles.replyQuote}>
                            <View style={styles.replyQuoteAccent} />
                            <Text style={styles.replyQuoteText} numberOfLines={1}>{getReplyPreviewText(message.replyTo)}</Text>
                          </View>
                        </View>
                      )}
                      <Pressable
                        style={styles.videoBubble}
                        onPress={() => setVideoPlayer(message.content)}
                        onLongPress={() => setReplyTo(message)}
                      >
                        <View style={styles.videoOverlay}>
                          <Ionicons name="play-circle" size={48} color="#FFFFFF" />
                          {dur > 0 && <Text style={styles.videoDuration}>{durLabel}</Text>}
                        </View>
                      </Pressable>
                      <Text style={[styles.messageTime, mine && styles.timeMine]}>
                        {formatMessageTime(message.createdAt)}
                        {mine ? `  ${message.isRead ? '✓✓' : '✓'}` : ''}
                      </Text>
                    </View>
                  );
                }

                return (
                  <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                    <Pressable
                      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
                      onLongPress={() => setReplyTo(message)}
                    >
                      {message.replyTo && (
                        <View style={styles.replyQuote}>
                          <View style={styles.replyQuoteAccent} />
                          <Text style={styles.replyQuoteText} numberOfLines={2}>{getReplyPreviewText(message.replyTo)}</Text>
                        </View>
                      )}
                      <Text style={styles.bubbleText}>{message.content}</Text>
                    </Pressable>
                    <Text style={[styles.messageTime, mine && styles.timeMine]}>
                      {formatMessageTime(message.createdAt)}
                      {mine ? `  ${message.isRead ? '✓✓' : '✓'}` : ''}
                    </Text>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyCopy}>Send the first message to start the conversation.</Text>
              </View>
            )}
          </ScrollView>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {replyTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyBarAccent} />
            <Text style={styles.replyBarLabel} numberOfLines={1}>{getReplyPreviewText(replyTo)}</Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.grayIcon} />
            </Pressable>
          </View>
        )}

        <View style={styles.inputRow}>
          {isRecording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTimer}>
                {`${Math.floor(recordingSec / 60)}:${String(recordingSec % 60).padStart(2, '0')}`}
              </Text>
              <Pressable style={styles.stopButton} onPress={handleStopRecording}>
                <Ionicons name="stop" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.sendButton, styles.attachButton, sending && styles.sendDisabled]}
                onPress={handlePickMedia}
                disabled={sending}
              >
                <Ionicons name="image-outline" size={22} color={colors.text} />
              </Pressable>
              <View style={styles.messageInput}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Your message"
                  placeholderTextColor={colors.grayIcon}
                  style={styles.input}
                  multiline
                />
              </View>
              <Pressable
                style={[styles.sendButton, styles.micButton, sending && styles.sendDisabled]}
                onPress={handleStartRecording}
                disabled={sending}
              >
                <Ionicons name="mic" size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable
                style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
                onPress={handleSend}
                disabled={!draft.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Ionicons name="send" size={22} color="#FFFFFF" />
                )}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Image viewer */}
      <Modal visible={imageViewer !== null} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalClose} onPress={() => setImageViewer(null)}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          {imageViewer && (
            <Image source={{ uri: imageViewer }} style={styles.fullImage} contentFit="contain" />
          )}
        </View>
      </Modal>

      {/* Video player */}
      <Modal visible={videoPlayer !== null} transparent animationType="fade" onRequestClose={handleCloseVideo}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalClose} onPress={handleCloseVideo}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          {videoPlayer && (
            <Video
              ref={videoRef}
              source={{ uri: videoPlayer }}
              style={styles.fullVideo}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginLeft: 12,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '900',
    maxWidth: 150,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  online: {
    color: colors.muted,
    fontSize: 12,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
  },
  dayLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  dayText: {
    color: colors.muted,
    fontSize: 12,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thread: {
    flex: 1,
    marginTop: 6,
  },
  threadContent: {
    paddingTop: 20,
    paddingBottom: 16,
    gap: 16,
  },
  emptyThread: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  systemMessage: {
    alignSelf: 'center',
    maxWidth: '86%',
    borderRadius: 999,
    backgroundColor: colors.soft,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  systemMessageText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  messageBlock: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
  },
  messageMine: {
    alignSelf: 'flex-end',
  },
  bubble: {
    borderRadius: 12,
    padding: 16,
  },
  bubbleOther: {
    backgroundColor: colors.soft,
  },
  bubbleMine: {
    backgroundColor: '#F3F3F5',
  },
  bubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTime: {
    color: colors.grayIcon,
    fontSize: 12,
    marginTop: 6,
  },
  timeMine: {
    textAlign: 'right',
    color: colors.primary,
  },
  errorText: {
    color: colors.primary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingBottom: 28,
  },
  messageInput: {
    flex: 1,
    minHeight: 52,
    maxHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  input: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  sendButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  micButton: {
    backgroundColor: colors.soft,
  },
  attachButton: {
    backgroundColor: colors.soft,
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  imageBubble: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  videoBubble: {
    width: 200,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
    // TODO: replace with video thumbnail once expo-video-thumbnails is added
  },
  videoOverlay: {
    alignItems: 'center',
    gap: 6,
  },
  videoDuration: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    borderRadius: 10,
    backgroundColor: colors.soft,
  },
  replyBarAccent: {
    width: 3,
    height: '100%',
    minHeight: 16,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyBarLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
  },
  replyQuoteWrapper: {
    paddingBottom: 2,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  replyQuote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  replyQuoteAccent: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 14,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyQuoteText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalClose: {
    position: 'absolute',
    top: 54,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '80%',
  },
  fullVideo: {
    width: '100%',
    height: '70%',
  },
  voiceBubble: {
    flexDirection: 'column',
    minWidth: 160,
    gap: 6,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  voiceInfo: {
    flex: 1,
    gap: 4,
  },
  voiceWave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  voiceBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.grayIcon,
  },
  voiceBarActive: {
    backgroundColor: colors.primary,
  },
  voiceDuration: {
    color: colors.muted,
    fontSize: 11,
  },
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingTimer: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  stopButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
