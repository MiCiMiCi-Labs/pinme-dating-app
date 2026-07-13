import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, IconButton } from '@/design/system';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { useChatMatches } from '@/queries/chat.queries';
import { $matchEvents, markMatchRefreshHandled } from '@/stores/matchEvents.store';
import { showToast } from '@/stores/toast.store';

export default function MatchesScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, refetch } = useChatMatches();
  const matches = Array.isArray(data) ? data : [];

  useEffect(() => {
    const unsubscribe = $matchEvents.subscribe((events) => {
      if (!events.pendingMatchRefresh || !events.latestMatch) return;
      showToast(`You matched with ${events.latestMatch.userName}`, 'success');
      refetch();
      markMatchRefreshHandled();
    });

    return unsubscribe;
  }, [refetch]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <IconButton icon="options-outline" />
      </View>
      <FlatList
        data={matches}
        keyExtractor={({ matchId }) => matchId}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await refetch();
          setRefreshing(false);
        }}
        contentContainerStyle={styles.content}
        columnWrapperStyle={styles.row}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item: { matchId, user } }) => {
          const primary = user.photos.find(p => p.isPrimary) ?? user.photos[0];
          const primaryPhotoUrl = primary ? getDisplayPhotoUrl(primary, 'thumbnail') : '';
          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/(main)/matches/[userId]', params: { userId: user.id } })}
            >
              {primaryPhotoUrl ? (
                <Image source={{ uri: primaryPhotoUrl }} style={styles.cardImage} contentFit="cover" />
              ) : (
                <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
              )}
              <View style={styles.cardFooter}>
                <Text style={styles.cardName}>{user.name}</Text>
                <Text style={styles.cardMeta}>{user.age}{user.city ? ` · ${user.city}` : ''}</Text>
              </View>
            </Pressable>
          );
        }}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>New matches</Text>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No matches yet</Text>
              <Text style={styles.emptySubtext}>Keep swiping to find your match!</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  content: {
    paddingHorizontal: 28,
    paddingBottom: 34,
    flexGrow: 1,
  },
  row: {
    gap: 14,
  },
  rowGap: {
    height: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 14,
  },
  card: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.line,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  cardImagePlaceholder: {
    backgroundColor: colors.line,
  },
  cardFooter: {
    padding: 12,
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
});
