import { Ionicons } from '@expo/vector-icons';
import { Audio, ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, IconButton, photos, ProfileThumb } from '@/design/system';
import {
  blockUser as blockUserApi,
  reportUser as reportUserApi,
  markMessagesRead,
  recallMessage,
  sendGifMessage,
  sendImageMessage,
  sendMessage,
  sendVideoMessage,
  sendVoiceMessage,
  toggleReaction,
  type ChatIntimacy,
  type ChatMatch,
  type ChatMessagesResponse,
  type ChatMessage,
  type Reaction,
  type ReplyPreview,
  getReplySuggestions,
} from '@/lib/api';
import { useCall } from '@/contexts/call';
import { useCallPreference, useCreateCallInvitation, useUpdateCallPreference } from '@/queries/call.queries';
import { supabase } from '@/lib/supabase';
import { STICKERS } from '@/lib/stickers';
import { readCachedThread, writeCachedThread } from '@/lib/chatMessageCache';
import { useAccessToken, useAuthUserId } from '@/queries/auth';
import { useChatMatches, useMessages } from '@/queries/chat.queries';
import { queryKeys } from '@/queries/keys';
import { useCurrentUser } from '@/queries/user.queries';
import { GifBubble } from '@/components/chat/GifBubble';
import { ImageBubble } from '@/components/chat/ImageBubble';
import { TextBubble } from '@/components/chat/TextBubble';
import { VideoBubble } from '@/components/chat/VideoBubble';
import { VoiceBubble } from '@/components/chat/VoiceBubble';
import { formatMessageTime, getReplyPreviewText } from '@/components/chat/chatUtils';
import {
  clearPendingMessage,
  clearUnreadCount,
  registerIncomingMessage,
  setActiveMatch,
  setPendingMessage,
} from '@/stores/chatEvents.store';
import { showToast } from '@/stores/toast.store';
import { markVoiceRoomNeedsRefresh } from '@/stores/voiceRoom.store';

const MESSAGE_SAFETY_SYNC_INTERVAL_MS = 5000;
const REALTIME_FALLBACK_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);
const RECALL_WINDOW_MS = 2 * 60 * 1000;
const REACTION_EMOJIS = ['❤️', '😂', '😮', '👍', '👎'] as const;

type ReplyTone = 'warm' | 'playful' | 'curious';

const REPLY_TONES: Array<{ value: ReplyTone; label: string }> = [
  { value: 'warm', label: 'Warm' },
  { value: 'playful', label: 'Playful' },
  { value: 'curious', label: 'Curious' },
];

const DEFAULT_INTIMACY: ChatIntimacy = {
  level: 0,
  label: 'New',
  color: 'white',
  score: 0,
  mutualDays: 0,
  currentStreakDays: 0,
};

function getIntimacyHeartColor(color: ChatIntimacy['color']) {
  switch (color) {
    case 'yellow': return '#F5B833';
    case 'pink': return '#F472B6';
    case 'red': return '#E5485C';
    case 'purple': return '#8B5CF6';
    default: return '#FFFFFF';
  }
}

type LocalChatMessage = ChatMessage & { _status?: 'sending' | 'failed' };

type RetryPayload =
  | { kind: 'text'; content: string; replyToId?: string }
  | { kind: 'voice'; uri: string; durationSec: number; replyToId?: string }
  | { kind: 'image'; uri: string; mimeType: string; replyToId?: string }
  | { kind: 'video'; uri: string; mimeType: string; durationSec: number; replyToId?: string }
  | { kind: 'gif'; url: string; replyToId?: string };

function logRealtimeStatus(matchId: string, status: string) {
  if (!__DEV__) return;
  console.log(`[chat realtime] ${matchId}: ${status} at ${new Date().toISOString()}`);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type RealtimeMessageRow = {
  id: string;
  match_id: string;
  sender_id: string | null;
  content: string;
  message_type: ChatMessage['messageType'];
  duration_sec: number | null;
  reply_to_id: string | null;
  recalled_at: string | null;
  is_read: boolean;
  created_at: string;
};

function mapRealtimeMessage(row: RealtimeMessageRow, knownMessages: ChatMessage[] = []): ChatMessage {
  let replyTo: ReplyPreview | null = null;
  if (row.reply_to_id) {
    const parent = knownMessages.find(m => m.id === row.reply_to_id);
    if (parent) {
      replyTo = {
        id: parent.id,
        content: parent.content,
        messageType: parent.messageType,
        recalledAt: parent.recalledAt,
        sender: parent.sender,
      };
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
    recalledAt: row.recalled_at ?? null,
    reactions: [],
    createdAt: row.created_at,
    sender: null,
    replyTo,
  };
}

function mergeMessage(current: LocalChatMessage[], incoming: LocalChatMessage): LocalChatMessage[] {
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
    // Realtime events carry reactions: [] — preserve existing reactions in that case
    reactions: (incoming.reactions?.length ?? 0) > 0 ? incoming.reactions : existing.reactions,
  };
  return next;
}

function reactionsSignature(reactions: Reaction[] | undefined | null): string {
  if (!reactions) return '';
  return reactions
    .slice()
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map(r => `${r.userId}:${r.emoji}`)
    .join(',');
}

function messagesAreEqual(a: LocalChatMessage[], b: LocalChatMessage[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((message, index) => {
    const next = b[index];
    return (
      message.id === next.id &&
      message.content === next.content &&
      message.messageType === next.messageType &&
      message.isRead === next.isRead &&
      message.recalledAt === next.recalledAt &&
      reactionsSignature(message.reactions) === reactionsSignature(next.reactions) &&
      message.createdAt === next.createdAt &&
      message.replyTo?.id === next.replyTo?.id
    );
  });
}

function flattenMessagePages(data?: { pages: ChatMessagesResponse[] }) {
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];

  data?.pages
    .slice()
    .reverse()
    .flatMap(page => page.messages)
    .forEach((message) => {
      if (seen.has(message.id)) return;
      seen.add(message.id);
      messages.push(message);
    });

  messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    messages,
    intimacy: data?.pages[0]?.intimacy ?? DEFAULT_INTIMACY,
  };
}

export default function ChatRoomScreen() {
  const params = useLocalSearchParams<{
    matchId?: string;
    userId?: string;
    name?: string;
    photoUrl?: string;
  }>();
  const matchId = firstParam(params.matchId);
  const routeUserId = firstParam(params.userId);
  const name = firstParam(params.name) ?? 'Chat';
  const photoUrl = firstParam(params.photoUrl) ?? photos.redhead;

  const scrollRef = useRef<ScrollView>(null);
  const appStateRef = useRef(AppState.currentState);
  const currentUserIdRef = useRef<string | null>(null);
  const messagesRef = useRef<LocalChatMessage[]>([]);
  const contentHeightRef = useRef(0);
  const previousContentHeightRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const preservingScrollOffsetRef = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryPayloads = useRef<Map<string, RetryPayload>>(new Map());
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [intimacy, setIntimacy] = useState<ChatIntimacy>(DEFAULT_INTIMACY);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replySuggestions, setReplySuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [replyTone, setReplyTone] = useState<ReplyTone>('warm');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingPulse = useRef(new Animated.Value(1)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const videoRef = useRef<Video | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [longPressTarget, setLongPressTarget] = useState<LocalChatMessage | null>(null);
  const [reactionTarget, setReactionTarget] = useState<ChatMessage | null>(null);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [videoPlayer, setVideoPlayer] = useState<string | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [dismissedInvitations, setDismissedInvitations] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const accessToken = useAccessToken();
  const authUserId = useAuthUserId();
  const { data: currentUserData, refetch: refetchCurrentUser } = useCurrentUser();
  const {
    refetch: refetchMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(matchId);
  const { data: chatMatches } = useChatMatches();
  const { startCall: startGlobalCall } = useCall();
  const { data: callPreference } = useCallPreference(matchId);
  const updateCallPreference = useUpdateCallPreference(matchId);
  const createCallInvitation = useCreateCallInvitation(matchId);
  const matchedUserId = routeUserId ?? (Array.isArray(chatMatches)
    ? chatMatches.find(match => match.matchId === matchId)?.user.id
    : undefined);

  const updateChatPreviewCache = useCallback((message: ChatMessage) => {
    if (!authUserId || !matchId) return;

    queryClient.setQueryData<ChatMatch[]>(queryKeys.chatMatches(authUserId), old => {
      if (!Array.isArray(old)) return old;

      const existing = old.find(item => item.matchId === matchId);
      if (!existing) return old;

      const existingLastTime = existing.lastMessage
        ? new Date(existing.lastMessage.createdAt).getTime()
        : 0;
      const nextMessageTime = new Date(message.createdAt).getTime();
      const updatesCurrentLastMessage = existing.lastMessage?.id === message.id;

      if (!updatesCurrentLastMessage && existingLastTime > nextMessageTime) {
        return old;
      }

      const nextMatch: ChatMatch = {
        ...existing,
        lastMessage: message,
        unreadCount: 0,
      };

      return [
        nextMatch,
        ...old.filter(item => item.matchId !== matchId),
      ];
    });
  }, [authUserId, matchId, queryClient]);

  useEffect(() => {
    let cancelled = false;

    async function loadCachedThread() {
      if (!authUserId || !matchId || messagesRef.current.length > 0) return;

      const cached = await readCachedThread(authUserId, matchId);
      if (!cached || cancelled) return;

      setMessages(cached.messages);
      if (cached.intimacy) setIntimacy(cached.intimacy);
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    }

    loadCachedThread();

    return () => {
      cancelled = true;
    };
  }, [authUserId, matchId]);

  const loadThread = useCallback(async (showLoading = true) => {
    if (!matchId) {
      setError('Missing match id');
      setLoading(false);
      return;
    }

    if (showLoading && messagesRef.current.length === 0) {
      setLoading(true);
    }
    setError(current => (current === 'Realtime connection failed. Refreshing messages.' ? null : current));

    try {
      if (!accessToken) return;

      let loadedMessages: ChatMessage[];
      let loadedIntimacy: ChatIntimacy;

      if (currentUserIdRef.current) {
        const messagesData = (await refetchMessages()).data;
        if (!messagesData) throw new Error('Failed to load messages');
        const flattened = flattenMessagePages(messagesData);
        loadedMessages = flattened.messages;
        loadedIntimacy = flattened.intimacy;
      } else {
        const [userResult, messagesResult] = await Promise.all([
          currentUserData ? Promise.resolve({ data: currentUserData }) : refetchCurrentUser(),
          refetchMessages(),
        ]);
        const userResponse = userResult.data;
        const messagesData = messagesResult.data;
        if (!userResponse || !messagesData) throw new Error('Failed to load messages');

        currentUserIdRef.current = userResponse.user.id;
        setCurrentUserId(userResponse.user.id);
        const flattened = flattenMessagePages(messagesData);
        loadedMessages = flattened.messages;
        loadedIntimacy = flattened.intimacy;
      }

      setIntimacy(loadedIntimacy);
      const latestMessage = loadedMessages[loadedMessages.length - 1];
      if (latestMessage) {
        updateChatPreviewCache(latestMessage);
      }
      setMessages(current => {
        const serverConfirmed = current.filter(m => !m._status);
        if (messagesAreEqual(serverConfirmed, loadedMessages)) return current;
        const pendingFailed = current.filter(m => m._status);
        if (!pendingFailed.length) return loadedMessages;
        return [...loadedMessages, ...pendingFailed].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
      if (authUserId) {
        writeCachedThread(authUserId, matchId, loadedMessages, loadedIntimacy);
      }
      await markMessagesRead(accessToken, matchId).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      if (showLoading) {
        setLoading(false);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
      }
    }
  }, [accessToken, authUserId, currentUserData, matchId, refetchCurrentUser, refetchMessages, updateChatPreviewCache]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!matchId) return;
    setActiveMatch(matchId);
    clearUnreadCount(matchId);

    return () => {
      setActiveMatch(null);
    };
  }, [matchId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!authUserId || !matchId || !messages.length) return;
    writeCachedThread(authUserId, matchId, messages, intimacy);
  }, [authUserId, intimacy, matchId, messages]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage || loading) return;

    previousContentHeightRef.current = contentHeightRef.current;
    preservingScrollOffsetRef.current = true;

    try {
      const result = await fetchNextPage();
      const flattened = flattenMessagePages(result.data);

      setIntimacy(flattened.intimacy);
      setMessages(current => {
        const pendingFailed = current.filter(message => message._status);
        const merged = flattened.messages.reduce<LocalChatMessage[]>(
          (acc, message) => mergeMessage(acc, message),
          []
        );

        return [...merged, ...pendingFailed].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    } catch (err) {
      preservingScrollOffsetRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to load earlier messages');
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loading]);

  useEffect(() => {
    if (!matchId) return;

    const activeMatchId = matchId;
    let closed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    function stopSafetySync() {
      if (!pollingRef.current) return;

      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    function ensureSafetySync() {
      if (pollingRef.current) return;
      if (appStateRef.current !== 'active') return;

      pollingRef.current = setInterval(() => {
        loadThread(false);
      }, MESSAGE_SAFETY_SYNC_INTERVAL_MS);
    }

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
            const message = mapRealtimeMessage(row, messagesRef.current);
            logRealtimeStatus(activeMatchId, `INSERT ${row.id}`);
            registerIncomingMessage({
              matchId: activeMatchId,
              messageId: row.id,
              senderId: row.sender_id,
              createdAt: row.created_at,
            });
            updateChatPreviewCache(message);
            setMessages(current => mergeMessage(current, message));
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
            const message = mapRealtimeMessage(row, messagesRef.current);
            logRealtimeStatus(activeMatchId, `UPDATE ${row.id}`);
            updateChatPreviewCache(message);
            setMessages(current => mergeMessage(current, message));
            if (row.recalled_at) {
              loadThread(false);
            }
          }
        )
        .subscribe((status) => {
          if (closed) return;
          logRealtimeStatus(activeMatchId, status);

          if (status === 'SUBSCRIBED') {
            setError(null);
            ensureSafetySync();
          }

          if (REALTIME_FALLBACK_STATUSES.has(status)) {
            setError('Realtime connection failed. Refreshing messages.');
            ensureSafetySync();
          }
        });
    }

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      const wasBackground = appStateRef.current === 'inactive' || appStateRef.current === 'background';
      appStateRef.current = nextAppState;

      if (nextAppState === 'active') {
        if (wasBackground) {
          loadThread(false);
        }
        ensureSafetySync();
      } else {
        stopSafetySync();
      }
    });

    startRealtime();

    return () => {
      closed = true;
      appStateSubscription.remove();
      if (channel) {
        supabase.removeChannel(channel);
      }
      stopSafetySync();
    };
  }, [loadThread, matchId, updateChatPreviewCache]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !matchId || sending) return;

    const pendingReplyTo = replyTo;
    const tempId = `pending-${Date.now()}`;

    retryPayloads.current.set(tempId, { kind: 'text', content, replyToId: pendingReplyTo?.id });

    const optimisticMessage: LocalChatMessage = {
      id: tempId,
      matchId,
      senderId: currentUserId,
      content,
      messageType: 'TEXT',
      durationSec: null,
      isRead: false,
      recalledAt: null,
      reactions: [],
      createdAt: new Date().toISOString(),
      sender: null,
      replyTo: pendingReplyTo ? {
        id: pendingReplyTo.id,
        content: pendingReplyTo.content,
        messageType: pendingReplyTo.messageType,
        recalledAt: pendingReplyTo.recalledAt,
        sender: pendingReplyTo.sender,
      } : null,
      _status: 'sending',
    };

    setDraft('');
    setReplyTo(null);
    setSending(true);
    setPendingMessage(tempId, 'sending');
    setMessages(current => mergeMessage(current, optimisticMessage));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');
      const { message } = await sendMessage(session.access_token, matchId, content, pendingReplyTo?.id);
      retryPayloads.current.delete(tempId);
      clearPendingMessage(tempId);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current.filter(item => item.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setPendingMessage(tempId, 'failed');
      setMessages(current => current.map(m =>
        m.id === tempId ? { ...m, _status: 'failed' as const } : m
      ));
    } finally {
      setSending(false);
    }
  };

  const handleGenerateReplySuggestions = async (tone: ReplyTone = replyTone) => {
    if (!matchId || loadingSuggestions) return;

    setReplyTone(tone);
    setAssistantOpen(true);
    setActionsOpen(false);
    setLoadingSuggestions(true);
    setSuggestionError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { suggestions } = await getReplySuggestions(session.access_token, matchId, tone);
      setReplySuggestions(suggestions);
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Failed to generate replies');
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleSubmitEditing = () => {
    if (draft.trim()) {
      handleSend();
    }
  };

  useEffect(() => {
    if (!isRecording) {
      recordingPulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingPulse, {
          toValue: 0.35,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(recordingPulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [isRecording, recordingPulse]);

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

  const handleCancelRecording = async () => {
    if (!recordingRef.current) return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSec(0);

    const rec = recordingRef.current;
    recordingRef.current = null;

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (_) {
      // recording already stopped or failed to load; nothing to clean up
    }
  };

  const handleStopRecording = async () => {
    if (!recordingRef.current || !matchId) return;

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
    setRecordingSec(0);

    const duration = recordingSec;
    const rec = recordingRef.current;
    const pendingReplyTo = replyTo;
    recordingRef.current = null;

    let tempId: string | null = null;

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      if (!uri) return;

      tempId = `pending-voice-${Date.now()}`;
      retryPayloads.current.set(tempId, { kind: 'voice', uri, durationSec: duration, replyToId: pendingReplyTo?.id });

      const optimisticMessage: LocalChatMessage = {
        id: tempId,
        matchId,
        senderId: currentUserId,
        content: uri,
        messageType: 'VOICE',
        durationSec: duration,
        isRead: false,
        recalledAt: null,
        reactions: [],
        createdAt: new Date().toISOString(),
        sender: null,
        replyTo: pendingReplyTo ? {
          id: pendingReplyTo.id,
          content: pendingReplyTo.content,
          messageType: pendingReplyTo.messageType,
          recalledAt: pendingReplyTo.recalledAt,
          sender: pendingReplyTo.sender,
        } : null,
        _status: 'sending',
      };

      setReplyTo(null);
      setSending(true);
      setMessages(current => mergeMessage(current, optimisticMessage));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = await sendVoiceMessage(session.access_token, matchId, uri, duration, pendingReplyTo?.id);
      retryPayloads.current.delete(tempId);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current.filter(m => m.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      if (tempId) {
        setMessages(current => current.map(m =>
          m.id === tempId ? { ...m, _status: 'failed' as const } : m
        ));
      } else {
        setError('Failed to send voice message');
      }
    } finally {
      setSending(false);
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

    const tempId = `pending-media-${Date.now()}`;

    const retryPayload: RetryPayload = isVideo
      ? { kind: 'video', uri: asset.uri, mimeType, durationSec: durationSec ?? 0, replyToId: pendingReplyTo?.id }
      : { kind: 'image', uri: asset.uri, mimeType, replyToId: pendingReplyTo?.id };
    retryPayloads.current.set(tempId, retryPayload);

    const optimisticMessage: LocalChatMessage = {
      id: tempId,
      matchId,
      senderId: currentUserId,
      content: asset.uri,
      messageType: isVideo ? 'VIDEO' : 'IMAGE',
      durationSec,
      isRead: false,
      recalledAt: null,
      reactions: [],
      createdAt: new Date().toISOString(),
      sender: null,
      replyTo: pendingReplyTo ? {
        id: pendingReplyTo.id,
        content: pendingReplyTo.content,
        messageType: pendingReplyTo.messageType,
        recalledAt: pendingReplyTo.recalledAt,
        sender: pendingReplyTo.sender,
      } : null,
      _status: 'sending',
    };

    setReplyTo(null);
    setSending(true);
    setMessages(current => mergeMessage(current, optimisticMessage));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = isVideo
        ? await sendVideoMessage(session.access_token, matchId, asset.uri, mimeType, durationSec ?? 0, pendingReplyTo?.id)
        : await sendImageMessage(session.access_token, matchId, asset.uri, mimeType, pendingReplyTo?.id);

      retryPayloads.current.delete(tempId);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current.filter(m => m.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setMessages(current => current.map(m =>
        m.id === tempId ? { ...m, _status: 'failed' as const } : m
      ));
    } finally {
      setSending(false);
    }
  };

  const handleCloseVideo = async () => {
    try { await videoRef.current?.stopAsync(); } catch { /* ignore */ }
    setVideoPlayer(null);
  };

  const handleRecall = async (messageId: string) => {
    if (!matchId) return;
    const snapshot = [...messagesRef.current];
    setMessages(current =>
      current.map(m => m.id === messageId ? { ...m, recalledAt: new Date().toISOString() } : m)
    );
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');
      await recallMessage(session.access_token, matchId, messageId);
    } catch (err) {
      setMessages(snapshot);
      setError(err instanceof Error ? err.message : 'Failed to recall message');
    }
  };

  const handleRetry = useCallback(async (tempId: string) => {
    const payload = retryPayloads.current.get(tempId);
    if (!payload || !matchId) return;

    const inFlight = messagesRef.current.find(m => m.id === tempId);
    if (inFlight?._status === 'sending') return;

    setMessages(current => current.map(m =>
      m.id === tempId ? { ...m, _status: 'sending' as const } : m
    ));
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      let message: ChatMessage;
      if (payload.kind === 'text') {
        ({ message } = await sendMessage(session.access_token, matchId, payload.content, payload.replyToId));
      } else if (payload.kind === 'voice') {
        ({ message } = await sendVoiceMessage(session.access_token, matchId, payload.uri, payload.durationSec, payload.replyToId));
      } else if (payload.kind === 'image') {
        ({ message } = await sendImageMessage(session.access_token, matchId, payload.uri, payload.mimeType, payload.replyToId));
      } else if (payload.kind === 'video') {
        ({ message } = await sendVideoMessage(session.access_token, matchId, payload.uri, payload.mimeType, payload.durationSec, payload.replyToId));
      } else {
        ({ message } = await sendGifMessage(session.access_token, matchId, payload.url, payload.replyToId));
      }

      retryPayloads.current.delete(tempId);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current.filter(m => m.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setMessages(current => current.map(m =>
        m.id === tempId ? { ...m, _status: 'failed' as const } : m
      ));
    } finally {
      setSending(false);
    }
  }, [matchId]);

  const handleCancelFailed = useCallback((tempId: string) => {
    retryPayloads.current.delete(tempId);
    setMessages(current => current.filter(m => m.id !== tempId));
  }, []);

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!matchId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');
      const { message } = await toggleReaction(session.access_token, matchId, messageId, emoji);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current, message));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update reaction');
    }
  };

  const handleSendGif = async (url: string) => {
    setStickerPickerOpen(false);
    setActionsOpen(false);
    if (!matchId) return;

    const pendingReplyTo = replyTo;
    const tempId = `pending-gif-${Date.now()}`;

    retryPayloads.current.set(tempId, { kind: 'gif', url, replyToId: pendingReplyTo?.id });

    const optimisticMessage: LocalChatMessage = {
      id: tempId,
      matchId,
      senderId: currentUserId ?? null,
      content: url,
      messageType: 'GIF',
      durationSec: null,
      isRead: false,
      recalledAt: null,
      reactions: [],
      createdAt: new Date().toISOString(),
      sender: null,
      replyTo: pendingReplyTo
        ? { id: pendingReplyTo.id, content: pendingReplyTo.content, messageType: pendingReplyTo.messageType, recalledAt: pendingReplyTo.recalledAt, sender: pendingReplyTo.sender }
        : null,
      _status: 'sending',
    };

    setReplyTo(null);
    setSending(true);
    setMessages(current => mergeMessage(current, optimisticMessage));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');
      const { message } = await sendGifMessage(session.access_token, matchId, url, pendingReplyTo?.id);
      retryPayloads.current.delete(tempId);
      updateChatPreviewCache(message);
      setMessages(current => mergeMessage(current.filter(m => m.id !== tempId), message));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setMessages(current => current.map(m =>
        m.id === tempId ? { ...m, _status: 'failed' as const } : m
      ));
    } finally {
      setSending(false);
    }
  };

  // Call button behavior per docs/private-voice-calling-spec.md "聊天页交互状态":
  // state D (mutually enabled) dials out immediately; states A/B show the
  // mutual-consent prompts instead of ever dialing directly.
  const handleStartCall = () => {
    if (!matchId) return;

    if (callPreference?.mutuallyEnabled) {
      startGlobalCall(matchId);
      return;
    }

    if (!callPreference?.mineEnabled) {
      Alert.alert(
        'Enable voice chat?',
        'Only starts once you both agree. You can turn it off anytime.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Invite to voice chat',
            onPress: () => {
              createCallInvitation.mutate(undefined, {
                onError: (err) => {
                  showToast(err instanceof Error ? err.message : 'Could not send invitation', 'error');
                },
              });
            },
          },
        ]
      );
      return;
    }

    Alert.alert('Waiting for a response', `Waiting for ${name} to agree to voice chat.`, [{ text: 'OK' }]);
  };

  const handleToggleCallPreference = () => {
    const nextEnabled = !callPreference?.mineEnabled;
    Alert.alert(
      nextEnabled ? 'Enable voice chat?' : 'Turn off voice chat?',
      nextEnabled
        ? 'Only starts once you both agree. You can turn it off anytime.'
        : `You won't be able to call ${name} until you turn this back on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextEnabled ? 'Enable' : 'Turn off',
          style: nextEnabled ? 'default' : 'destructive',
          onPress: () => {
            updateCallPreference.mutate(nextEnabled, {
              onError: (err) => {
                showToast(err instanceof Error ? err.message : 'Could not update voice chat setting', 'error');
              },
            });
          },
        },
      ]
    );
  };

  const getTokenOrToast = () => {
    if (!accessToken) {
      showToast('Please log in again.', 'error');
      return null;
    }
    return accessToken;
  };

  const handleBlockUser = () => {
    if (!matchedUserId) {
      showToast('Could not find this user to block.', 'error');
      return;
    }

    Alert.alert(
      'Block this user?',
      `${name} will no longer be able to interact with you. This chat will be hidden.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const token = getTokenOrToast();
            if (!token) return;

            try {
              await blockUserApi(token, matchedUserId);
              markVoiceRoomNeedsRefresh();
              showToast('User blocked', 'success');
              router.replace('/(main)/chats');
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Failed to block user.', 'error');
            }
          },
        },
      ],
    );
  };

  const submitReport = async (reason: string) => {
    if (!matchedUserId) {
      showToast('Could not find this user to report.', 'error');
      return;
    }

    const token = getTokenOrToast();
    if (!token) return;

    try {
      await reportUserApi(token, { reportedId: matchedUserId, reason });
      showToast('Report submitted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to report user.', 'error');
    }
  };

  const handleReportUser = () => {
    Alert.alert('Report profile', 'Choose the reason that best fits.', [
      { text: 'Harassment or abuse', onPress: () => submitReport('Harassment or abuse') },
      { text: 'Fake profile or scam', onPress: () => submitReport('Fake profile or scam') },
      { text: 'Inappropriate content', onPress: () => submitReport('Inappropriate content') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openSafetyMenu = () => {
    Alert.alert(name, 'Safety options', [
      { text: 'Report profile', onPress: handleReportUser },
      { text: 'Block user', style: 'destructive', onPress: handleBlockUser },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleThreadScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    lastScrollYRef.current = y;

    if (y <= 80) {
      handleLoadOlderMessages();
    }
  };

  const handleThreadContentSizeChange = (_width: number, height: number) => {
    const previousHeight = contentHeightRef.current;
    contentHeightRef.current = height;

    if (preservingScrollOffsetRef.current) {
      const delta = height - previousContentHeightRef.current;
      preservingScrollOffsetRef.current = false;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, lastScrollYRef.current + delta),
          animated: false,
        });
      });
      return;
    }

    if (previousHeight === 0) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    }
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
                <View style={styles.intimacyPill}>
                  <Text style={[styles.intimacyHeart, { color: getIntimacyHeartColor(intimacy.color) }]}>♥</Text>
                </View>
              </View>
            </View>
          </View>
          <IconButton icon="ellipsis-horizontal" onPress={openSafetyMenu} />
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
            refreshControl={
              <RefreshControl
                refreshing={isFetchingNextPage}
                onRefresh={handleLoadOlderMessages}
              />
            }
            onScroll={handleThreadScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleThreadContentSizeChange}
          >
            {isFetchingNextPage ? (
              <View style={styles.olderLoadingRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.olderLoadingText}>Loading earlier messages...</Text>
              </View>
            ) : null}
            {messages.length ? (
              messages.map(message => {
                if (message.messageType === 'SYSTEM') {
                  // State C: "{partner} invited you to enable voice chat." is
                  // actionable for the recipient only — the inviter sees the
                  // same shared transcript line with no buttons (they already
                  // did the inviting; docs/private-voice-calling-spec.md
                  // "聊天页交互状态").
                  const isVoiceInvitation =
                    message.content === `${name} invited you to enable voice chat.`;
                  const isActionable =
                    isVoiceInvitation &&
                    !callPreference?.mineEnabled &&
                    !dismissedInvitations.has(message.id);

                  return (
                    <View
                      key={message.id}
                      style={[styles.systemMessage, isActionable && styles.systemMessageCard]}
                    >
                      <Text style={styles.systemMessageText}>{message.content}</Text>
                      {isActionable && (
                        <View style={styles.invitationActions}>
                          <Pressable
                            style={styles.invitationDismiss}
                            onPress={() =>
                              setDismissedInvitations(current => new Set(current).add(message.id))
                            }
                          >
                            <Text style={styles.invitationDismissText}>Not now</Text>
                          </Pressable>
                          <Pressable
                            style={styles.invitationAllow}
                            onPress={() =>
                              updateCallPreference.mutate(true, {
                                onError: err => {
                                  showToast(
                                    err instanceof Error ? err.message : 'Could not enable voice chat',
                                    'error'
                                  );
                                },
                              })
                            }
                          >
                            <Text style={styles.invitationAllowText}>Allow voice calls</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                }

                const mine = message.senderId === currentUserId;
                const commonProps = {
                  mine,
                  currentUserId,
                  onLongPress: () => setLongPressTarget(message),
                  onToggleReaction: (emoji: string) => handleToggleReaction(message.id, emoji),
                  onRetry: () => handleRetry(message.id),
                };

                if (message.recalledAt) {
                  return (
                    <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                      <Pressable
                        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, styles.recalledBubble]}
                        onLongPress={() => setLongPressTarget(message)}
                      >
                        <Text style={styles.recalledText}>Message recalled</Text>
                      </Pressable>
                      <Text style={[styles.messageTime, mine && styles.timeMine]}>
                        {formatMessageTime(message.createdAt)}
                      </Text>
                    </View>
                  );
                }

                switch (message.messageType) {
                  case 'VOICE':
                    return (
                      <VoiceBubble
                        key={message.id}
                        message={message}
                        isPlaying={playingId === message.id}
                        onPlay={() => handlePlayVoice(message.id, message.content)}
                        {...commonProps}
                      />
                    );
                  case 'IMAGE':
                    return (
                      <ImageBubble
                        key={message.id}
                        message={message}
                        onPress={() => setImageViewer(message.content)}
                        {...commonProps}
                      />
                    );
                  case 'GIF':
                    return (
                      <GifBubble
                        key={message.id}
                        message={message}
                        onPress={() => setImageViewer(message.content)}
                        {...commonProps}
                      />
                    );
                  case 'VIDEO':
                    return (
                      <VideoBubble
                        key={message.id}
                        message={message}
                        onPress={() => setVideoPlayer(message.content)}
                        {...commonProps}
                      />
                    );
                  default:
                    return (
                      <TextBubble
                        key={message.id}
                        message={message}
                        {...commonProps}
                      />
                    );
                }
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

        {actionsOpen && (
          <View style={styles.actionsTray}>
            <Pressable style={styles.actionTile} onPress={() => {
              setActionsOpen(false);
              handleStartCall();
            }}>
              <Ionicons name="call-outline" size={22} color={colors.primary} />
              <Text style={styles.actionLabel}>Call</Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => {
              setActionsOpen(false);
              handleToggleCallPreference();
            }}>
              <Ionicons
                name={callPreference?.mineEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
                size={22}
                color={colors.primary}
              />
              <Text style={styles.actionLabel}>
                {callPreference?.mineEnabled ? 'Voice: On' : 'Voice: Off'}
              </Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => {
              setActionsOpen(false);
              handlePickMedia();
            }}>
              <Ionicons name="image-outline" size={22} color={colors.primary} />
              <Text style={styles.actionLabel}>Photo</Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => {
              setActionsOpen(false);
              setStickerPickerOpen(true);
            }}>
              <Ionicons name="film-outline" size={22} color={colors.primary} />
              <Text style={styles.actionLabel}>GIF</Text>
            </Pressable>
            <Pressable style={styles.actionTile} onPress={() => handleGenerateReplySuggestions(replyTone)}>
              <Ionicons name="sparkles" size={22} color={colors.primary} />
              <Text style={styles.actionLabel}>AI reply</Text>
            </Pressable>
          </View>
        )}

        {assistantOpen && (
          <View style={styles.assistantPanel}>
            <View style={styles.assistantHandle} />
            <View style={styles.suggestionsHeader}>
              <Text style={styles.suggestionsTitle}>AI reply assistant</Text>
              <Pressable onPress={() => {
                setAssistantOpen(false);
                setReplySuggestions([]);
                setSuggestionError(null);
              }} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.grayIcon} />
              </Pressable>
            </View>

            <View style={styles.toneRow}>
              {REPLY_TONES.map((tone) => {
                const selected = tone.value === replyTone;
                return (
                  <Pressable
                    key={tone.value}
                    style={[styles.toneButton, selected && styles.toneButtonActive]}
                    onPress={() => handleGenerateReplySuggestions(tone.value)}
                    disabled={loadingSuggestions}
                  >
                    <Text style={[styles.toneButtonText, selected && styles.toneButtonTextActive]}>
                      {tone.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {loadingSuggestions ? (
              <View style={styles.suggestionLoadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.suggestionMuted}>Writing suggestions...</Text>
              </View>
            ) : null}

            {suggestionError ? (
              <Text style={styles.suggestionError}>{suggestionError}</Text>
            ) : null}

            {replySuggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                style={styles.suggestionChip}
                onPress={() => {
                  setDraft(suggestion);
                  setAssistantOpen(false);
                  setReplySuggestions([]);
                  setSuggestionError(null);
                }}
              >
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          {isRecording ? (
            <>
              <Pressable style={styles.cancelRecordingButton} onPress={handleCancelRecording}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
              <View style={styles.recordingRow}>
                <Animated.View style={[styles.recordingDot, { opacity: recordingPulse }]} />
                <Text style={styles.recordingLabel}>Recording</Text>
                <Text style={styles.recordingTimer}>
                  {`${Math.floor(recordingSec / 60)}:${String(recordingSec % 60).padStart(2, '0')}`}
                </Text>
              </View>
              <Pressable style={styles.stopButton} onPress={handleStopRecording}>
                <Ionicons name="stop" size={22} color="#FFFFFF" />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.composerButton, sending && styles.sendDisabled]}
                onPress={handleStartRecording}
                disabled={sending}
              >
                <Ionicons name="mic-outline" size={20} color={colors.primary} />
              </Pressable>
              <View style={styles.messageInput}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Your message"
                  placeholderTextColor={colors.grayIcon}
                  style={styles.input}
                  multiline
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={handleSubmitEditing}
                />
              </View>
              <Pressable
                style={[styles.composerButton, actionsOpen && styles.composerButtonActive]}
                onPress={() => {
                  setActionsOpen(current => !current);
                  setAssistantOpen(false);
                }}
                disabled={sending}
              >
                <Ionicons name={actionsOpen ? 'close' : 'add'} size={24} color={actionsOpen ? '#FFFFFF' : colors.primary} />
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

      {/* Long press action menu */}
      <Modal
        visible={longPressTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLongPressTarget(null)}
      >
        <Pressable style={styles.actionOverlay} onPress={() => setLongPressTarget(null)}>
          <View style={styles.actionMenu}>
            {longPressTarget?._status === 'failed' ? (
              <>
                <Pressable
                  style={styles.actionMenuItem}
                  onPress={() => {
                    handleRetry(longPressTarget!.id);
                    setLongPressTarget(null);
                  }}
                >
                  <Ionicons name="refresh-outline" size={20} color={colors.text} />
                  <Text style={styles.actionMenuText}>Retry</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                  onPress={() => {
                    handleCancelFailed(longPressTarget!.id);
                    setLongPressTarget(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  <Text style={[styles.actionMenuText, { color: '#EF4444' }]}>Remove</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={styles.actionMenuItem}
                  onPress={() => {
                    setReplyTo(longPressTarget!);
                    setLongPressTarget(null);
                  }}
                >
                  <Ionicons name="return-up-back-outline" size={20} color={colors.text} />
                  <Text style={styles.actionMenuText}>Reply</Text>
                </Pressable>

                {!longPressTarget?.recalledAt && (
                  <Pressable
                    style={styles.actionMenuItem}
                    onPress={() => {
                      setReactionTarget(longPressTarget);
                      setLongPressTarget(null);
                    }}
                  >
                    <Ionicons name="happy-outline" size={20} color={colors.text} />
                    <Text style={styles.actionMenuText}>React</Text>
                  </Pressable>
                )}

                {longPressTarget &&
                  longPressTarget.senderId === currentUserId &&
                  !longPressTarget.recalledAt &&
                  Date.now() - new Date(longPressTarget.createdAt).getTime() <= RECALL_WINDOW_MS && (
                  <Pressable
                    style={[styles.actionMenuItem, styles.actionMenuItemDanger]}
                    onPress={() => {
                      handleRecall(longPressTarget!.id);
                      setLongPressTarget(null);
                    }}
                  >
                    <Ionicons name="arrow-undo-outline" size={20} color="#EF4444" />
                    <Text style={[styles.actionMenuText, { color: '#EF4444' }]}>Recall</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Reaction picker */}
      <Modal
        visible={reactionTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionTarget(null)}
      >
        <Pressable style={styles.actionOverlay} onPress={() => setReactionTarget(null)}>
          <View style={styles.reactionPicker}>
            {REACTION_EMOJIS.map(emoji => (
              <Pressable
                key={emoji}
                style={styles.reactionPickerEmoji}
                onPress={() => {
                  if (reactionTarget) handleToggleReaction(reactionTarget.id, emoji);
                  setReactionTarget(null);
                }}
              >
                <Text style={styles.reactionPickerEmojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Sticker / GIF picker */}
      <Modal
        visible={stickerPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setStickerPickerOpen(false)}
      >
        <Pressable style={styles.actionOverlay} onPress={() => setStickerPickerOpen(false)}>
          <Pressable style={styles.stickerSheet} onPress={() => {}}>
            <View style={styles.stickerSheetHandle} />
            <Text style={styles.stickerSheetTitle}>Stickers</Text>
            <View style={styles.stickerGrid}>
              {STICKERS.map(sticker => (
                <Pressable
                  key={sticker.id}
                  style={styles.stickerItem}
                  onPress={() => handleSendGif(sticker.url)}
                >
                  <Image
                    source={{ uri: sticker.url }}
                    style={styles.stickerThumb}
                    contentFit="cover"
                  />
                  <Text style={styles.stickerLabel}>{sticker.label}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
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
  headerActions: {
    flexDirection: 'row',
    gap: 4,
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
  intimacyPill: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.soft,
    marginLeft: 3,
  },
  intimacyHeart: {
    fontSize: 13,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.16)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
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
  olderLoadingRow: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  olderLoadingText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
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
  systemMessageCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  invitationActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
  },
  invitationDismiss: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  invitationDismissText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  invitationAllow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  invitationAllowText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
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
  actionsTray: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionTile: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  assistantPanel: {
    borderWidth: 1,
    borderColor: colors.line,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
    marginBottom: 12,
  },
  assistantHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
  },
  suggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionsTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  toneRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toneButton: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  toneButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  toneButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  toneButtonTextActive: {
    color: '#FFFFFF',
  },
  suggestionLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionMuted: {
    color: colors.muted,
    fontSize: 13,
  },
  suggestionError: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
  },
  suggestionChip: {
    borderRadius: 12,
    backgroundColor: colors.soft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  composerButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerButtonActive: {
    backgroundColor: colors.primary,
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
  aiButton: {
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
  recalledBubble: {
    opacity: 0.6,
  },
  recalledText: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  reactionChipMine: {
    borderColor: colors.primary,
    backgroundColor: '#FFF0F0',
  },
  reactionChipText: {
    fontSize: 13,
    color: colors.text,
  },
  actionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  actionMenu: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 4,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  actionMenuItemDanger: {
    borderBottomWidth: 0,
  },
  actionMenuText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
  },
  reactionPicker: {
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 50,
    padding: 8,
    gap: 4,
    marginBottom: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  reactionPickerEmoji: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  reactionPickerEmojiText: {
    fontSize: 28,
  },
  cancelRecordingButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: 27,
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingLabel: {
    flex: 1,
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
  recordingTimer: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  gifContainer: {
    width: 180,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.soft,
  },
  gifBubble: {
    width: '100%',
    height: '100%',
  },
  gifBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  gifBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stickerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  stickerSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
    marginBottom: 14,
  },
  stickerSheetTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 14,
  },
  stickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stickerItem: {
    width: '22%',
    alignItems: 'center',
    gap: 4,
  },
  stickerThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: colors.soft,
  },
  stickerLabel: {
    fontSize: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  statusRowMine: {
    justifyContent: 'flex-end',
  },
  statusSpinner: {
    transform: [{ scale: 0.55 }],
  },
  statusSendingText: {
    color: colors.muted,
    fontSize: 11,
  },
  statusFailedText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
  },
});
