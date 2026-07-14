import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@nanostores/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { DiscoverCard, MatchOverlay } from '@/components/discover';
import { colors, IconButton } from '@/design/system';
import { createSwipe, type DiscoveryUser, type PublicUser } from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { useLikesList, useMatchFromLikesList } from '@/queries/chat.queries';
import { useMyPhotos } from '@/queries/profile.queries';
import { useAccessToken } from '@/queries/auth';
import { $hiddenLikedUserIds, hideLikedUser } from '@/stores/likedYou.store';
import { showToast } from '@/stores/toast.store';

const SWIPE_THRESHOLD = 100;

function toDiscoveryUser(user: PublicUser): DiscoveryUser {
  return {
    ...user,
    distanceKm: null,
  };
}

export default function LikesYouScreen() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchedUser, setMatchedUser] = useState<PublicUser | null>(null);
  const [matchedMatchId, setMatchedMatchId] = useState<string | null>(null);
  const { height } = useWindowDimensions();
  const { data, isLoading, error, refetch, isRefetching } = useLikesList();
  const photosQuery = useMyPhotos();
  const matchMutation = useMatchFromLikesList();
  const accessToken = useAccessToken();
  const hiddenLikedUserIds = useStore($hiddenLikedUserIds);
  const likedBy = (data?.likedBy ?? []).filter(user => !hiddenLikedUserIds.has(user.id));
  const cardHeight = Math.min(height * 0.54, 440);
  const pan = useRef(new Animated.ValueXY()).current;
  const swipingRef = useRef(false);
  const currentUserRef = useRef<PublicUser | null>(null);
  const handleDecisionRef = useRef<(direction: 'like' | 'nope') => void>(() => {});
  const currentUser = users[currentIndex] ?? null;
  const currentDiscoveryUser = currentUser ? toDiscoveryUser(currentUser) : null;
  currentUserRef.current = currentUser;
  const myPhotoUrl = useMemo(() => {
    const photos = photosQuery.data ?? [];
    const primary = photos.find(photo => photo.isPrimary) ?? photos[0];
    return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : null;
  }, [photosQuery.data]);

  useEffect(() => {
    setUsers(likedBy);
    setCurrentIndex(0);
    pan.setValue({ x: 0, y: 0 });
  }, [data?.likedBy, hiddenLikedUserIds, pan]);

  useEffect(() => {
    const nextUser = users[currentIndex + 1];
    if (!nextUser) return;
    const primary = nextUser.photos.find(photo => photo.isPrimary) ?? nextUser.photos[0];
    if (!primary) return;
    Image.prefetch(getDisplayPhotoUrl(primary, 'thumbnail')).catch(() => {});
  }, [users, currentIndex]);

  const handleDecision = useCallback((direction: 'like' | 'nope') => {
    const user = currentUserRef.current;
    swipingRef.current = false;
    pan.setValue({ x: 0, y: 0 });
    setCurrentIndex(index => index + 1);

    if (!user) return;

    if (direction === 'nope') {
      hideLikedUser(user.id);
      if (accessToken) {
        createSwipe(accessToken, user.id, 'DISLIKE').catch(() => null);
      }
      return;
    }

    matchMutation.mutate(user, {
      onSuccess: ({ result }) => {
        if (result.match) {
          setMatchedUser(user);
          setMatchedMatchId(result.match.id);
        } else {
          showToast(`${user.name} moved to your swipes`, 'info');
        }
      },
      onError: (mutationError) => {
        showToast(
          mutationError instanceof Error ? mutationError.message : 'Failed to match',
          'error'
        );
      },
    });
  }, [accessToken, matchMutation, pan]);

  handleDecisionRef.current = handleDecision;

  const animateSwipe = useCallback((direction: 'like' | 'nope') => {
    if (swipingRef.current || !currentUserRef.current) return;
    swipingRef.current = true;
    const toX = direction === 'like' ? 500 : -500;
    Animated.timing(pan, {
      toValue: { x: toX, y: 0 },
      duration: 260,
      useNativeDriver: false,
    }).start(() => handleDecisionRef.current(direction));
  }, [pan]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (_, gesture) => {
        const user = currentUserRef.current;
        if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
          if (user) {
            router.push({
              pathname: '/(main)/matches/[userId]',
              params: { userId: user.id, source: 'likes' },
            });
          }
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          return;
        }

        if (!swipingRef.current && (gesture.dx > SWIPE_THRESHOLD || gesture.vx > 0.8)) {
          swipingRef.current = true;
          Animated.timing(pan, { toValue: { x: 500, y: gesture.dy }, duration: 260, useNativeDriver: false })
            .start(() => handleDecisionRef.current('like'));
        } else if (!swipingRef.current && (gesture.dx < -SWIPE_THRESHOLD || gesture.vx < -0.8)) {
          swipingRef.current = true;
          Animated.timing(pan, { toValue: { x: -500, y: gesture.dy }, duration: 260, useNativeDriver: false })
            .start(() => handleDecisionRef.current('nope'));
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

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

      <View style={styles.content}>
        {isLoading || isRefetching ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.emptyState}>
            <Ionicons name="lock-closed-outline" size={34} color={colors.primary} />
            <Text style={styles.emptyTitle}>Premium required</Text>
            <Text style={styles.emptySubtext}>
              {error instanceof Error ? error.message : 'Unlock premium to view this list.'}
            </Text>
            <Pressable style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : currentDiscoveryUser ? (
          <>
            <View style={[styles.deck, { height: cardHeight + 38 }]}>
              {users[currentIndex + 1] ? (
                <View style={[styles.backCard, { height: cardHeight + 10 }]} />
              ) : null}
              <DiscoverCard
                key={currentDiscoveryUser.id}
                user={currentDiscoveryUser}
                height={cardHeight}
                pan={pan}
                panHandlers={panResponder.panHandlers}
              />
            </View>
            <View style={styles.likedActions}>
              <Pressable style={styles.passButton} onPress={() => animateSwipe('nope')}>
                <Ionicons name="close" size={32} color={colors.orange} />
              </Pressable>
              <Pressable style={styles.matchButtonLarge} onPress={() => animateSwipe('like')}>
                <Ionicons name="heart" size={34} color="#FFFFFF" />
                <Text style={styles.matchButtonLargeText}>Match</Text>
              </Pressable>
            </View>
            <Text style={styles.deckHint}>Swipe right to match, left to pass.</Text>
          </>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={34} color={colors.primary} />
            <Text style={styles.emptyTitle}>No secret likes yet</Text>
            <Text style={styles.emptySubtext}>
              New likes will appear here when people swipe right on you.
            </Text>
          </View>
        )}
      </View>

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
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 34,
  },
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: 16,
    borderRadius: 24,
    backgroundColor: '#E8EEF5',
    transform: [{ scale: 0.94 }],
  },
  deckHint: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
  },
  likedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 12,
  },
  passButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  matchButtonLarge: {
    minWidth: 158,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  matchButtonLargeText: {
    color: '#FFFFFF',
    fontSize: 16,
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
