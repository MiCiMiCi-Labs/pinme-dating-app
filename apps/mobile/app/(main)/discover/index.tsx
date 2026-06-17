import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useEffect } from 'react';
import { Animated, PanResponder, SafeAreaView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { DiscoverCard, FilterSheet, MatchOverlay, SwipeActions } from '@/components/discover';
import { colors, IconButton, PrimaryButton, ScreenTitle } from '@/design/system';
import { createSwipe, getCurrentAppUser, getDiscoveryFeed, getMyPhotos, type DiscoveryUser } from '@/lib/api';
import {
  getDetailedProfileCompletion,
  matchingProfileCompletionThreshold,
} from '@/lib/profileCompleteness';
import { supabase } from '@/lib/supabase';
import { filterSwiped, markSwiped } from '@/lib/swipedUsers';

const SWIPE_THRESHOLD = 100;

export default function SwipeScreen() {
  const [users, setUsers] = useState<DiscoveryUser[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [matchedUser, setMatchedUser] = useState<DiscoveryUser | null>(null);
  const [matchedMatchId, setMatchedMatchId] = useState<string | null>(null);
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null);
  const [profileCompletionPercent, setProfileCompletionPercent] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [feedKey, setFeedKey] = useState(0);
  const { height } = useWindowDimensions();
  const cardHeight = Math.min(height * 0.54, 440);

  const pan = useRef(new Animated.ValueXY()).current;
  const hasLoadedRef = useRef(false);
  const swipingRef = useRef(false);
  const currentUserRef = useRef<DiscoveryUser | null>(null);
  const handleSwipeRef = useRef<(dir: 'like' | 'nope') => void>(() => {});

  const currentUser = users[currentIndex] ?? null;
  currentUserRef.current = currentUser;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        if (!hasLoadedRef.current) setLoading(true);
        try {
          const [{ user: appUser }, myPhotos] = await Promise.all([
            getCurrentAppUser(session.access_token),
            getMyPhotos(session.access_token).catch(() => [] as Awaited<ReturnType<typeof getMyPhotos>>),
          ]);

          const completion = getDetailedProfileCompletion(appUser, myPhotos);

          if (!cancelled) {
            setProfileCompletionPercent(completion.percent);
          }

          if (completion.percent < matchingProfileCompletionThreshold) {
            if (!cancelled) {
              setUsers([]);
              setCurrentIndex(0);
              const primary = myPhotos.find(p => p.isPrimary) ?? myPhotos[0];
              setMyPhotoUrl(primary?.url ?? null);
              hasLoadedRef.current = true;
            }
            return;
          }

          const { users: feed } = await getDiscoveryFeed(session.access_token);

          if (!cancelled) {
            setUsers(feed);
            setCurrentIndex(0);
            pan.setValue({ x: 0, y: 0 });
            const primary = myPhotos.find(p => p.isPrimary) ?? myPhotos[0];
            setMyPhotoUrl(primary?.url ?? null);
            hasLoadedRef.current = true;
          }
        } catch {
          // keep existing state on error
        } finally {
          if (!cancelled) {
            hasLoadedRef.current = true;
            setLoading(false);
          }
        }
      }
    } catch {
      // keep existing state on error
    } finally {
      if (!cancelled?.current) setLoading(false);
    }
  }, [pan]);

  useFocusEffect(
    useCallback(() => {
      setUsers(prev => filterSwiped(prev));
      const cancelled = { current: false };
      loadFeed(cancelled);
      return () => { cancelled.current = true; };
    }, [loadFeed])
  );

  useEffect(() => {
    if (feedKey === 0) return;
    loadFeed();
  }, [feedKey, loadFeed]);

  const handleSwipe = useCallback(async (direction: 'like' | 'nope') => {
    const user = currentUserRef.current;
    swipingRef.current = false;
    pan.setValue({ x: 0, y: 0 });
    setCurrentIndex(prev => prev + 1);

    if (!user) return;
    markSwiped(user.id);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const { match } = await createSwipe(
        session.access_token,
        user.id,
        direction === 'like' ? 'LIKE' : 'DISLIKE',
      );
      if (match) {
        setMatchedUser(user);
        setMatchedMatchId(match.id);
      }
    } catch {
      // non-blocking — card already advanced
    }
  }, [pan]);

  handleSwipeRef.current = handleSwipe;

  const animateSwipe = useCallback((direction: 'like' | 'nope') => {
    if (swipingRef.current || !currentUserRef.current) return;
    swipingRef.current = true;
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
          Animated.timing(pan, { toValue: { x: 500, y: gesture.dy }, duration: 280, useNativeDriver: false })
            .start(() => handleSwipeRef.current('like'));
        } else if (!swipingRef.current && (gesture.dx < -SWIPE_THRESHOLD || gesture.vx < -0.8)) {
          swipingRef.current = true;
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
        {!loading &&
        profileCompletionPercent !== null &&
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
        ) : !loading && !currentUser ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>You're all caught up</Text>
            <Text style={styles.emptySubtext}>No more profiles for now — check back later</Text>
          </View>
        ) : (
          <>
            {users[currentIndex + 1] ? (
              <View style={[styles.backCard, { height: cardHeight + 10 }]} />
            ) : null}
            {currentUser ? (
              <DiscoverCard
                key={currentUser.id}
                user={currentUser}
                height={cardHeight}
                pan={pan}
                panHandlers={panResponder.panHandlers}
              />
            ) : null}
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
          onApply={() => setFeedKey(k => k + 1)}
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
                  name: matchedUser.name,
                  photoUrl: primaryPhoto?.url ?? '',
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
