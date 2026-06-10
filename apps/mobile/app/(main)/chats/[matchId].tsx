import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
  sendMessage,
  type ChatMessage,
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThread = useCallback(async () => {
    if (!matchId) {
      setError('Missing match id');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

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
      setLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    }
  }, [matchId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !matchId || sending) return;

    setDraft('');
    setSending(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please log in again.');

      const { message } = await sendMessage(session.access_token, matchId, content);
      setMessages(current => [...current, message]);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setDraft(content);
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
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
                return (
                  <View key={message.id} style={[styles.messageBlock, mine && styles.messageMine]}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                      <Text style={styles.bubbleText}>{message.content}</Text>
                    </View>
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

        <View style={styles.inputRow}>
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
        </View>
      </KeyboardAvoidingView>
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
});
