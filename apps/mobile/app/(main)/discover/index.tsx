import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DiscoverCard, DiscoverySkeleton, FilterSheet, MatchOverlay, SwipeActions } from '@/components/discover';
import { colors, IconButton, PrimaryButton, ScreenTitle } from '@/design/system';
import { type DiscoveryUser } from '@/lib/api';
import { cacheDiscoveryUsers } from '@/lib/discovery-cache';
import {
  getDetailedProfileCompletion,
  matchingProfileCompletionThreshold,
} from '@/lib/profileCompleteness';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { filterSwiped, markSwiped } from '@/lib/swipedUsers';
import { useCurrentUser } from '@/queries/user.queries';
import { useMyPhotos } from '@/queries/profile.queries';
import {
  DISCOVERY_MAX_BUFFER,
  DISCOVERY_PAGE_SIZE,
  DISCOVERY_PREFETCH_THRESHOLD,
  useCreateSwipe,
  useDiscoveryFeed,
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
import { setProfileCompletion } from '@/stores/profileCompletion.store';

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
  const currentUserQuery = useCurrentUser();
  const photosQuery = useMyPhotos();
  const completion = useMemo(() => {
    if (!currentUserQuery.data?.user || !photosQuery.data) return null;
    return getDetailedProfileCompletion(currentUserQuery.data.user, photosQuery.data);
  }, [currentUserQuery.data?.user, photosQuery.data]);
  const canDiscover = Boolean(completion && completion.percent >= matchingProfileCompletionThreshold);
  const feedQuery = useDiscoveryFeed(canDiscover);
  const resetFeed = useResetDiscoveryFeed();
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  const swipeMutation = useCreateSwipe();
  const myPhotoUrl = useMemo(() => {
    const photos = photosQuery.data ?? [];
    const primary = photos.find(p => p.isPrimary) ?? photos[0];
    return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : null;
  }, [photosQuery.data]);
  const loading = currentUserQuery.isLoading || photosQuery.isLoading || (canDiscover && feedQuery.isLoading);
  const profileCompletionPercent = completion?.percent ?? null;

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
    if (!completion) return;
    setProfileCompletion(completion);
  }, [completion]);

  useEffect(() => {
    if (!canDiscover) {
      setUsers([]);
      setCurrentIndex(0);
      return;
    }
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
  }, [canDiscover, currentIndex, feedQuery.data?.pages]);

  useEffect(() => {
    if (!canDiscover || !feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    const remaining = users.length - currentIndex - 1;
    if (remaining <= DISCOVERY_PREFETCH_THRESHOLD) {
      feedQuery.fetchNextPage().catch(() => null);
    }
  }, [canDiscover, currentIndex, feedQuery, users.length]);

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
    } catch (_) {
      // non-blocking — card already advanced
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
            router.push({
              pathname: '/(main)/discover/[userId]',
              params: { userId: currentUserRef.current.id },
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
        ) : profileCompletionPercent !== null &&
          profileCompletionPercent < matchingProfileCompletionThreshold ? (
          <View style={styles.lockedState}>
            <Text style={styles.emptyTitle}>Complete your profile first</Text>
            <Text style={styles.emptySubtext}>
              Your profile is {profileCompletionPercent}% complete. Reach {matchingProfileCompletionThreshold}% to start matching.
            </Text>
            <PrimaryButton onPress={() => router.push('/(main)/profile')} style={styles.lockedButton}>
              Improve profile
            </PrimaryButton>
          </View>
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

      {profileCompletionPercent === null ||
      profileCompletionPercent >= matchingProfileCompletionThreshold ? (
        <SwipeActions
          onNope={() => animateSwipe('nope')}
          onLike={() => animateSwipe('like')}
        />
      ) : null}

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
          myPhotoUrl={myPhotoUrl}
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
  lockedState: {
    alignItems: 'center',
    paddingHorizontal: 34,
    gap: 12,
  },
  lockedButton: {
    alignSelf: 'stretch',
    marginTop: 8,
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
