import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChatPreviewRow } from '@/components/cards';
import { colors, photos, ProfileThumb } from '@/design/system';
import { type ChatMatch } from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { useChatMatches } from '@/queries/chat.queries';
import { $chatEvents, markChatRefreshHandled, setUnreadCounts } from '@/stores/chatEvents.store';

function getPrimaryPhoto(match: ChatMatch) {
  const primary = match.user.photos.find(photo => photo.isPrimary) ?? match.user.photos[0];
  return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : photos.redhead;
}

function getIntimacyHeartColor(color: ChatMatch['intimacy']['color']) {
  switch (color) {
    case 'yellow': return '#F5B833';
    case 'pink': return '#F472B6';
    case 'red': return '#E5485C';
    case 'purple': return '#8B5CF6';
    default: return '#FFFFFF';
  }
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
  const msg = match.lastMessage;
  if (!msg) return 'Say hello and start the conversation';
  if (msg.recalledAt) return 'Message recalled';
  switch (msg.messageType) {
    case 'SYSTEM': return msg.content;
    case 'TEXT':   return msg.content;
    case 'VOICE':  return '[Voice message]';
    case 'IMAGE':  return '[Photo]';
    case 'VIDEO':  return '[Video]';
    case 'GIF':    return '[GIF]';
    default:       return msg.content;
  }
}

export default function ChatListScreen() {
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useChatMatches();
  const matches = Array.isArray(data) ? data : [];

  useEffect(() => {
    setUnreadCounts(
      Object.fromEntries(matches.map(match => [match.matchId, match.unreadCount]))
    );
  }, [matches]);

  useEffect(() => {
    const unsubscribe = $chatEvents.subscribe((events) => {
      const matchIds = Object.keys(events.chatNeedsRefreshByMatchId);
      if (!matchIds.length) return;
      refetch();
      matchIds.forEach(markChatRefreshHandled);
    });

    return unsubscribe;
  }, [refetch]);

  const filteredMatches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return matches;
    return matches.filter(match => match.user.name.toLowerCase().includes(trimmed));
  }, [matches, query]);

  const activityMatches = matches.slice(0, 5);

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={filteredMatches}
        keyExtractor={match => match.matchId}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refetch();
              setRefreshing(false);
            }}
          />
        }
        renderItem={({ item: match, index }) => (
          <ChatPreviewRow
            name={match.user.name}
            text={getPreview(match)}
            time={formatRelativeTime(match.lastMessage?.createdAt ?? match.createdAt)}
            unread={match.unreadCount}
            image={getPrimaryPhoto(match)}
            intimacyColor={getIntimacyHeartColor(match.intimacy?.color ?? 'white')}
            showDivider={index < filteredMatches.length - 1}
            onPress={() => router.push({
              pathname: '/(main)/chats/[matchId]',
              params: {
                matchId: match.matchId,
                userId: match.user.id,
                name: match.user.name,
                photoUrl: getPrimaryPhoto(match),
              },
            })}
          />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.title}>Messages</Text>
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
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Text style={styles.errorText}>
                {error instanceof Error ? error.message : 'Failed to load chats'}
              </Text>
            </View>
          ) : (
            <View style={styles.centerState}>
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptyCopy}>When you match with someone, you can start chatting here.</Text>
            </View>
          )
        }
      />
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
