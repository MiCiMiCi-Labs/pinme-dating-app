import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@nanostores/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MatchOverlay } from '@/components/discover';
import { colors, IconButton } from '@/design/system';
import { type DiscoveryUser, type PublicUser } from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { useLikesList, useMatchFromLikesList } from '@/queries/chat.queries';
import { useMyPhotos } from '@/queries/profile.queries';
import { $hiddenLikedUserIds } from '@/stores/likedYou.store';
import { showToast } from '@/stores/toast.store';

function toDiscoveryUser(user: PublicUser): DiscoveryUser {
  return {
    ...user,
    distanceKm: null,
  };
}

export default function LikesYouScreen() {
  const [matchedUser, setMatchedUser] = useState<PublicUser | null>(null);
  const [matchedMatchId, setMatchedMatchId] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const { data, isLoading, error, refetch, isRefetching } = useLikesList();
  const photosQuery = useMyPhotos();
  const matchMutation = useMatchFromLikesList();
  const hiddenLikedUserIds = useStore($hiddenLikedUserIds);
  const likedBy = (data?.likedBy ?? []).filter(user => !hiddenLikedUserIds.has(user.id));
  const cardWidth = (width - 24 * 2 - 14) / 2;
  const myPhotoUrl = useMemo(() => {
    const photos = photosQuery.data ?? [];
    const primary = photos.find(photo => photo.isPrimary) ?? photos[0];
    return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : null;
  }, [photosQuery.data]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Liked you</Text>
          <Text style={styles.subtitle}>People already interested in you</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={likedBy}
        keyExtractor={item => item.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        refreshing={isRefetching}
        onRefresh={refetch}
        contentContainerStyle={styles.content}
        columnWrapperStyle={likedBy.length > 1 ? styles.row : undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Ionicons
                  name={error ? 'lock-closed-outline' : 'heart-outline'}
                  size={34}
                  color={colors.primary}
                />
                <Text style={styles.emptyTitle}>
                  {error ? 'Premium required' : 'No secret likes yet'}
                </Text>
                <Text style={styles.emptySubtext}>
                  {error
                    ? error instanceof Error
                      ? error.message
                      : 'Unlock premium to view this list.'
                    : 'New likes will appear here when people swipe right on you.'}
                </Text>
                {error ? (
                  <Pressable style={styles.retryButton} onPress={() => refetch()}>
                    <Text style={styles.retryText}>Try again</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const primary = item.photos.find(photo => photo.isPrimary) ?? item.photos[0];
          const photoUrl = primary ? getDisplayPhotoUrl(primary, 'thumbnail') : '';
          const matchingThisUser = matchMutation.isPending && matchMutation.variables?.id === item.id;

          return (
            <Pressable
              style={[styles.card, { width: cardWidth }]}
              onPress={() => router.push({ pathname: '/(main)/matches/[userId]', params: { userId: item.id } })}
            >
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.cardImage} contentFit="cover" />
              ) : (
                <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                  <Ionicons name="person" size={28} color={colors.grayIcon} />
                </View>
              )}
              <View style={styles.cardGradient}>
                <Text style={styles.cardName}>{item.name}, {item.age}</Text>
                <Text style={styles.cardMeta}>{item.city ?? item.profile?.jobTitle ?? 'Liked your profile'}</Text>
                <Pressable
                  disabled={matchingThisUser}
                  onPress={(event) => {
                    event.stopPropagation();
                    matchMutation.mutate(item, {
                      onSuccess: ({ result }) => {
                        if (result.match) {
                          setMatchedUser(item);
                          setMatchedMatchId(result.match.id);
                        } else {
                          showToast(`${item.name} moved to your swipes`, 'info');
                        }
                      },
                      onError: (mutationError) => {
                        showToast(
                          mutationError instanceof Error ? mutationError.message : 'Failed to match',
                          'error'
                        );
                      },
                    });
                  }}
                  style={[styles.matchButton, matchingThisUser && styles.matchButtonDisabled]}
                >
                  <Ionicons name="heart" size={16} color="#FFFFFF" />
                  <Text style={styles.matchButtonText}>
                    {matchingThisUser ? 'Matching...' : 'Match'}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          );
        }}
      />

      {matchedUser ? (
        <MatchOverlay
          matchedUser={toDiscoveryUser(matchedUser)}
          myPhotoUrl={myPhotoUrl}
          onKeepSwiping={() => {
            setMatchedUser(null);
            setMatchedMatchId(null);
          }}
          onSayHello={() => {
            const primaryPhoto = matchedUser.photos.find(photo => photo.isPrimary) ?? matchedUser.photos[0];
            const matchId = matchedMatchId;
            setMatchedUser(null);
            setMatchedMatchId(null);
            if (matchId) {
              router.push({
                pathname: '/(main)/chats/[matchId]',
                params: {
                  matchId,
                  userId: matchedUser.id,
                  name: matchedUser.name,
                  photoUrl: primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : '',
                },
              });
            } else {
              router.push('/(main)/chats');
            }
          }}
        />
      ) : null}
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 34,
  },
  row: {
    gap: 14,
  },
  card: {
    aspectRatio: 0.78,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.line,
    marginBottom: 14,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    backgroundColor: 'rgba(16,17,22,0.45)',
  },
  cardName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  cardMeta: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    marginTop: 3,
  },
  matchButton: {
    marginTop: 12,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  matchButtonDisabled: {
    opacity: 0.72,
  },
  matchButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  emptyState: {
    flex: 1,
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
