import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChatPreviewRow } from '@/components/cards';
import { colors, IconButton, photos, ProfileThumb } from '@/design/system';
import { getChatMatches, type ChatMatch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

function getPrimaryPhoto(match: ChatMatch) {
  return (match.user.photos.find(photo => photo.isPrimary) ?? match.user.photos[0])?.url ?? photos.redhead;
}

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

function getPreview(match: ChatMatch) {
  if (!match.lastMessage) return 'Say hello and start the conversation';
  if (match.lastMessage.messageType === 'SYSTEM') return match.lastMessage.content;
  if (match.lastMessage.messageType !== 'TEXT') return match.lastMessage.messageType.toLowerCase();
  return match.lastMessage.content;
}

export default function ChatListScreen() {
  const [matches, setMatches] = useState<ChatMatch[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadMatches = useCallback(async (showSpinner = true) => {
    if (showSpinner && !hasLoadedRef.current) setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMatches([]);
        return;
      }

      const data = await getChatMatches(session.access_token);
      setMatches(data);
      hasLoadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMatches(!hasLoadedRef.current);
    }, [loadMatches])
  );

  const filteredMatches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return matches;
    return matches.filter(match => match.user.name.toLowerCase().includes(trimmed));
  }, [matches, query]);

  const activityMatches = matches.slice(0, 5);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadMatches(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Messages</Text>
          <IconButton icon="refresh-outline" onPress={() => loadMatches()} />
        </View>

        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={colors.grayIcon} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.grayIcon}
            style={styles.searchInput}
          />
        </View>

        <Text style={styles.sectionTitle}>Activities</Text>
        {activityMatches.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityRow}>
            {activityMatches.map(match => (
              <View key={match.matchId} style={styles.activityItem}>
                <View style={styles.activityRing}>
                  <ProfileThumb uri={getPrimaryPhoto(match)} size={58} />
                </View>
                <Text style={styles.activityName} numberOfLines={1}>{match.user.name}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyCopy}>Your matches will appear here.</Text>
        )}

        <Text style={styles.sectionTitle}>Messages</Text>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : filteredMatches.length ? (
          <View style={styles.list}>
            {filteredMatches.map((match, index) => (
              <ChatPreviewRow
                key={match.matchId}
                name={match.user.name}
                text={getPreview(match)}
                time={formatRelativeTime(match.lastMessage?.createdAt ?? match.createdAt)}
                unread={match.unreadCount}
                image={getPrimaryPhoto(match)}
                showDivider={index < filteredMatches.length - 1}
                onPress={() => router.push({
                  pathname: '/(main)/chats/[matchId]',
                  params: {
                    matchId: match.matchId,
                    name: match.user.name,
                    photoUrl: getPrimaryPhoto(match),
                  },
                })}
              />
            ))}
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.emptyCopy}>When you match with someone, you can start chatting here.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  search: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
    marginTop: 30,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 14,
  },
  activityRow: {
    gap: 18,
    paddingRight: 22,
  },
  activityItem: {
    width: 66,
    alignItems: 'center',
    gap: 8,
  },
  activityRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 70,
  },
  list: {
    gap: 0,
  },
  centerState: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
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
  errorText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
  },
});
