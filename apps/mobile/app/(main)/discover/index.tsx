import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoverCard, DiscoverySkeleton, FilterSheet, MatchOverlay, SwipeActions } from '@/components/discover';
import { colors, IconButton, ScreenTitle } from '@/design/system';
import { isMatchLimitError, type DiscoveryUser } from '@/lib/api';
import { cacheDiscoveryUsers } from '@/lib/discovery-cache';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { filterSwiped, markSwiped } from '@/lib/swipedUsers';
import {
  DISCOVERY_MAX_BUFFER,
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_PREFETCH_THRESHOLD,
  useCreateSwipe,
  useDiscoveryFeed,
  useResetDiscoveryFeed,
} from '@/queries/discovery.queries';
import {
  $discoveryUi,
  markDiscoveryRefreshHandled,
  setDiscoveryCurrentIndex,
  setDiscoveryFilterOpen,
  setDiscoveryLastSwipeAction,
  setDiscoverySwipeLocked,
} from '@/stores/discoveryUi.store';
import { registerMatchSuccess } from '@/stores/matchEvents.store';

const SWIPE_THRESHOLD = 100;

export default function SwipeScreen() {
  const [users, setUsers] = useState<DiscoveryUser[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchedUser, setMatchedUser] = useState<DiscoveryUser | null>(null);
  const [matchedMatchId, setMatchedMatchId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const { height } = useWindowDimensions();
  const cardHeight = Math.min(height * 0.54, 440);

  const pan = useRef(new Animated.ValueXY()).current;
  const swipingRef = useRef(false);
  const currentUserRef = useRef<DiscoveryUser | null>(null);
  const handleSwipeRef = useRef<(dir: 'like' | 'nope') => void>(() => {});
  const feedQuery = useDiscoveryFeed(true);
  const resetFeed = useResetDiscoveryFeed();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  const swipeMutation = useCreateSwipe();
  const loading = feedQuery.isLoading;

  const currentUser = users[currentIndex] ?? null;
  currentUserRef.current = currentUser;
  const remaining = users.length - currentIndex;

  useEffect(() => {
    setDiscoveryCurrentIndex(currentIndex);
  }, [currentIndex]);

  useEffect(() => {
    setDiscoveryFilterOpen(filterOpen);
  }, [filterOpen]);

  useEffect(() => {
    const unsubscribe = $discoveryUi.subscribe((state) => {
      if (!state.discoveryNeedsRefresh) return;
      markDiscoveryRefreshHandled();
      pan.setValue({ x: 0, y: 0 });
      setCurrentIndex(prev => prev + 1);
    });

    return unsubscribe;
  }, [pan]);

  useEffect(() => {
    const pages = feedQuery.data?.pages;
    if (!pages) return;

    const uniqueUsers = new Map<string, DiscoveryUser>();
    pages.flatMap(page => page.users).forEach((user) => {
      if (!uniqueUsers.has(user.id)) uniqueUsers.set(user.id, user);
    });

    const nextUsers = filterSwiped(Array.from(uniqueUsers.values())).slice(0, DISCOVERY_MAX_BUFFER);
    cacheDiscoveryUsers(nextUsers);
    setUsers(nextUsers);
    if (currentIndex >= nextUsers.length) {
      setCurrentIndex(Math.max(0, nextUsers.length - 1));
    }
  }, [currentIndex, feedQuery.data?.pages]);

  useEffect(() => {
    if (!feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    const remaining = users.length - currentIndex - 1;
    if (remaining <= DISCOVERY_PREFETCH_THRESHOLD) {
      feedQuery.fetchNextPage().catch(() => null);
    }
  }, [currentIndex, feedQuery, users.length]);

  useEffect(() => {
    const nextUser = users[currentIndex + 1];
    if (!nextUser) return;
    const primary = nextUser.photos.find(p => p.isPrimary) ?? nextUser.photos[0];
    if (!primary) return;
    Image.prefetch(getDisplayPhotoUrl(primary, 'thumbnail')).catch(() => {});
  }, [users, currentIndex]);

  useEffect(() => {
    if (remaining <= 2 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [remaining, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSwipe = useCallback(async (direction: 'like' | 'nope') => {
    const user = currentUserRef.current;
    swipingRef.current = false;
    setDiscoverySwipeLocked(false);
    setDiscoveryLastSwipeAction(direction);
    pan.setValue({ x: 0, y: 0 });
    const nextIndex = currentIndex + 1;
    if (nextIndex >= DISCOVERY_PAGE_SIZE) {
      setUsers(current => current.slice(nextIndex));
      setCurrentIndex(0);
    } else {
      setCurrentIndex(nextIndex);
    }

    if (!user) return;
    markSwiped(user.id);

    try {
      const { match } = await swipeMutation.mutateAsync({
        targetId: user.id,
        action: direction === 'like' ? 'LIKE' : 'DISLIKE',
      });
      if (match) {
        const primaryPhoto = user.photos.find(photo => photo.isPrimary) ?? user.photos[0];
        registerMatchSuccess({
          matchId: match.id,
          userId: user.id,
          userName: user.name,
          photoUrl: primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : undefined,
        });
        setMatchedUser(user);
        setMatchedMatchId(match.id);
      }
    } catch (error) {
      if (isMatchLimitError(error)) {
        Alert.alert(
          'Match limit reached',
          error instanceof Error
            ? error.message
            : 'Unmatch someone to keep discovering new people.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Manage matches', onPress: () => router.push('/(main)/matches') },
          ]
        );
      }
    }
  }, [currentIndex, pan, swipeMutation]);

  handleSwipeRef.current = handleSwipe;

  const animateSwipe = useCallback((direction: 'like' | 'nope') => {
    if (swipingRef.current || !currentUserRef.current) return;
    swipingRef.current = true;
    setDiscoverySwipeLocked(true);
    const toX = direction === 'like' ? 500 : -500;
    Animated.timing(pan, {
      toValue: { x: toX, y: 0 },
      duration: 280,
      useNativeDriver: false,
    }).start(() => handleSwipeRef.current(direction));
  }, [pan]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
          if (currentUserRef.current) {
            const user = currentUserRef.current;
            const primaryPhoto = user.photos.find(photo => photo.isPrimary) ?? user.photos[0];
            router.push({
              pathname: '/(main)/discover/[userId]',
              params: {
                userId: user.id,
                name: user.name,
                age: String(user.age),
                city: user.city ?? '',
                gender: user.gender,
                photoUrl: primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : '',
              },
            });
          }
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          return;
        }
        if (!swipingRef.current && (gesture.dx > SWIPE_THRESHOLD || gesture.vx > 0.8)) {
          swipingRef.current = true;
          setDiscoverySwipeLocked(true);
          Animated.timing(pan, { toValue: { x: 500, y: gesture.dy }, duration: 280, useNativeDriver: false })
            .start(() => handleSwipeRef.current('like'));
        } else if (!swipingRef.current && (gesture.dx < -SWIPE_THRESHOLD || gesture.vx < -0.8)) {
          swipingRef.current = true;
          setDiscoverySwipeLocked(true);
          Animated.timing(pan, { toValue: { x: -500, y: gesture.dy }, duration: 280, useNativeDriver: false })
            .start(() => handleSwipeRef.current('nope'));
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenTitle
        title="Discover"
        subtitle={currentUser?.city ?? ''}
        right={<IconButton icon="options-outline" onPress={() => setFilterOpen(true)} />}
      />

      <View style={[styles.deck, { height: cardHeight + 38 }]}>
        {loading ? (
          <DiscoverySkeleton height={cardHeight} />
        ) : !currentUser && feedQuery.isFetchingNextPage ? (
          <DiscoverySkeleton height={cardHeight} />
        ) : !currentUser ? (
          isFetchingNextPage || hasNextPage ? (
            <DiscoverySkeleton height={cardHeight} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>You're all caught up</Text>
              <Text style={styles.emptySubtext}>No more profiles for now — check back later</Text>
            </View>
          )
        ) : (
          <>
            {users[currentIndex + 1] || isFetchingNextPage ? (
              <View style={[styles.backCard, { height: cardHeight + 10 }]} />
            ) : null}
            <DiscoverCard
              key={currentUser.id}
              user={currentUser}
              height={cardHeight}
              pan={pan}
              panHandlers={panResponder.panHandlers}
            />
          </>
        )}
      </View>

      <SwipeActions
        onNope={() => animateSwipe('nope')}
        onLike={() => animateSwipe('like')}
      />

      {filterOpen ? (
        <FilterSheet
          onClose={() => setFilterOpen(false)}
          onApply={() => {
            setUsers([]);
            setCurrentIndex(0);
            pan.setValue({ x: 0, y: 0 });
            feedQuery.refetch();
          }}
        />
      ) : null}

      {matchedUser ? (
        <MatchOverlay
          matchedUser={matchedUser}
          myPhotoUrl={null}
          onKeepSwiping={() => {
            setMatchedUser(null);
            setMatchedMatchId(null);
          }}
          onSayHello={() => {
            const primaryPhoto = matchedUser.photos.find(photo => photo.isPrimary) ?? matchedUser.photos[0];
            setMatchedUser(null);
            if (matchedMatchId) {
              router.push({
                pathname: '/(main)/chats/[matchId]',
                params: {
                  matchId: matchedMatchId,
                  userId: matchedUser.id,
                  name: matchedUser.name,
                  photoUrl: primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : '',
                },
              });
            } else {
              router.push('/(main)/chats');
            }
            setMatchedMatchId(null);
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
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  backCard: {
    position: 'absolute',
    width: '58%',
    borderRadius: 14,
    backgroundColor: '#D7E5F2',
    top: 6,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
});
