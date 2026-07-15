import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoCarousel, ProfileDetailContent } from '@/components/profile-detail';
import { colors } from '@/design/system';
import { blockUser as blockUserApi, createSwipe, getUserById, reportUser as reportUserApi, type PublicUser } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { getCachedDiscoveryUser } from '@/lib/discovery-cache';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { markSwiped } from '@/lib/swipedUsers';
import { useDislikeFromLikesList, useMatchFromLikesList } from '@/queries/chat.queries';
import { markDiscoveryNeedsRefresh } from '@/stores/discoveryUi.store';
import { markVoiceRoomNeedsRefresh } from '@/stores/voiceRoom.store';
import { showToast } from '@/stores/toast.store';

type ProfileDetailSource = 'discover' | 'likes' | 'matches';

function resolveSource(raw: string | undefined): ProfileDetailSource {
  return raw === 'likes' || raw === 'matches' ? raw : 'discover';
}

export default function ProfileDetailScreen() {
  const {
    userId,
    matchId,
    source: rawSource,
    photoUrl,
  } = useLocalSearchParams<{
    userId: string;
    matchId?: string;
    source?: string;
    name?: string;
    photoUrl?: string;
  }>();
  const source = resolveSource(rawSource);
  const { session } = useAuth();
  const likeFromLikesMutation = useMatchFromLikesList();
  const dislikeFromLikesMutation = useDislikeFromLikesList();
  const [user, setUser] = useState<PublicUser | null>(() => getCachedDiscoveryUser(userId));
  const [loading, setLoading] = useState(!getCachedDiscoveryUser(userId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [stamp, setStamp] = useState<'like' | 'nope' | null>(null);
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(1.4)).current;
  const { height } = useWindowDimensions();
  const carouselHeight = Math.min(height * 0.55, 440);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId || !session?.access_token) return;
      try {
        const { user: data } = await getUserById(session.access_token, userId);
        if (!cancelled) setUser(data);
      } catch (err) {
        console.error('[ProfileDetail] getUserById failed:', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [session?.access_token, userId]);

  const showStamp = (type: 'like' | 'nope', then: () => void) => {
    setStamp(type);
    stampOpacity.setValue(0);
    stampScale.setValue(1.4);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(stampOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(280),
        Animated.timing(stampOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
      ]),
      Animated.spring(stampScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
    ]).start(() => {
      setStamp(null);
      then();
    });
  };

  const handleLike = () => {
    if (!user || liked || source === 'matches') return;
    setLiked(true);

    if (source === 'likes') {
      markSwiped(user.id);
      showStamp('like', () => {
        likeFromLikesMutation.mutate(user, {
          onSuccess: ({ result }) => {
            const { match } = result;
            if (match) {
              const primaryPhoto = user.photos.find(p => p.isPrimary) ?? user.photos[0];
              const primaryPhotoUrl = primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : '';
              Alert.alert("It's a match! 🎉", `You and ${user.name} liked each other`, [
                { text: 'Keep browsing', onPress: () => router.back() },
                {
                  text: 'Say hello',
                  onPress: () => router.replace({
                    pathname: '/(main)/chats/[matchId]',
                    params: { matchId: match.id, userId: user.id, name: user.name, photoUrl: primaryPhotoUrl },
                  }),
                },
              ]);
            } else {
              router.back();
            }
          },
          onError: (err) => {
            showToast(err instanceof Error ? err.message : 'Failed to like user.', 'error');
            router.back();
          },
        });
      });
      return;
    }

    // source === 'discover'
    markSwiped(user.id);
    markDiscoveryNeedsRefresh();

    const apiPromise = (async () => {
      if (!session?.access_token) return null;
      try {
        return await createSwipe(session.access_token, user.id, 'LIKE');
      } catch (_) {
        return null;
      }
    })();

    showStamp('like', async () => {
      const result = await apiPromise;
      if (!result) { router.back(); return; }
      const { match } = result;
      if (match) {
        const primaryPhoto = user.photos.find(p => p.isPrimary) ?? user.photos[0];
        const primaryPhotoUrl = primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : '';
        Alert.alert("It's a match! 🎉", `You and ${user.name} liked each other`, [
          { text: 'Keep browsing', onPress: () => router.back() },
          {
            text: 'Say hello',
            onPress: () => router.replace({
              pathname: '/(main)/chats/[matchId]',
              params: { matchId: match.id, userId: user.id, name: user.name, photoUrl: primaryPhotoUrl },
            }),
          },
        ]);
      } else {
        router.back();
      }
    });
  };

  const handleDislike = () => {
    if (!user || disliking || source === 'matches') return;
    setDisliking(true);

    if (source === 'likes') {
      markSwiped(user.id);
      showStamp('nope', () => {
        dislikeFromLikesMutation.mutate(user, {
          onSuccess: () => router.back(),
          onError: (err) => {
            showToast(err instanceof Error ? err.message : 'Failed to pass on user.', 'error');
            router.back();
          },
        });
      });
      return;
    }

    // source === 'discover'
    markSwiped(user.id);
    markDiscoveryNeedsRefresh();
    const uid = user.id;
    if (session?.access_token) {
      createSwipe(session.access_token, uid, 'DISLIKE').catch(() => {});
    }
    showStamp('nope', () => router.back());
  };

  const handleMessage = () => {
    if (!user || !matchId) return;
    const primaryPhoto = user.photos.find(p => p.isPrimary) ?? user.photos[0];
    router.push({
      pathname: '/(main)/chats/[matchId]',
      params: {
        matchId,
        userId: user.id,
        name: user.name,
        photoUrl: photoUrl ?? (primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : ''),
      },
    });
  };

  const getAccessToken = () => {
    const token = session?.access_token;
    if (!token) {
      showToast('Please log in again.', 'error');
      return null;
    }
    return token;
  };

  const handleBlock = () => {
    if (!user) return;

    Alert.alert(
      'Block this user?',
      `${user.name} will no longer be able to interact with you. Existing chats and swipes will be hidden.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const token = getAccessToken();
            if (!token || !user) return;

            try {
              await blockUserApi(token, user.id);
              markSwiped(user.id);
              markVoiceRoomNeedsRefresh();
              showToast('User blocked', 'success');
              router.back();
            } catch (err) {
              showToast(err instanceof Error ? err.message : 'Failed to block user.', 'error');
            }
          },
        },
      ],
    );
  };

  const submitReport = async (reason: string) => {
    if (!user) return;
    const token = getAccessToken();
    if (!token) return;

    try {
      await reportUserApi(token, { reportedId: user.id, reason });
      showToast('Report submitted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to report user.', 'error');
    }
  };

  const handleReport = () => {
    Alert.alert('Report profile', 'Choose the reason that best fits.', [
      { text: 'Harassment or abuse', onPress: () => submitReport('Harassment or abuse') },
      { text: 'Fake profile or scam', onPress: () => submitReport('Fake profile or scam') },
      { text: 'Inappropriate content', onPress: () => submitReport('Inappropriate content') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openSafetyMenu = () => {
    if (!user) return;

    Alert.alert(user.name, 'Safety options', [
      { text: 'Report profile', onPress: handleReport },
      { text: 'Block user', style: 'destructive', onPress: handleBlock },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading && !user) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.skeletonHero, { height: carouselHeight }]} />
        <View style={styles.skeletonBody}>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, { width: '48%', height: 14, marginTop: 0 }]} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError && !user) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const photos = user ? [
    ...user.photos.filter(p => p.isPrimary),
    ...user.photos.filter(p => !p.isPrimary).sort((a, b) => a.orderIndex - b.orderIndex),
  ] : [];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View>
          <PhotoCarousel photos={photos} height={carouselHeight} onMorePress={openSafetyMenu} />
          {stamp !== null && (
            <Animated.View
              style={[
                styles.stamp,
                stamp === 'like' ? styles.stampLike : styles.stampNope,
                {
                  opacity: stampOpacity,
                  transform: [
                    { rotate: stamp === 'like' ? '-15deg' : '15deg' },
                    { scale: stampScale },
                  ],
                },
              ]}
              pointerEvents="none"
            >
              <Animated.Text style={[styles.stampText, stamp === 'like' ? styles.stampTextLike : styles.stampTextNope]}>
                {stamp === 'like' ? 'LIKE' : 'NOPE'}
              </Animated.Text>
            </Animated.View>
          )}
        </View>
        <ProfileDetailContent
          user={user}
          onLike={handleLike}
          onDislike={handleDislike}
          onMessage={matchId ? handleMessage : undefined}
          liked={liked}
          variant={source === 'matches' ? 'matched' : 'discovery'}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  skeletonHero: {
    backgroundColor: colors.line,
  },
  skeletonBody: {
    paddingHorizontal: 28,
    paddingTop: 24,
    gap: 12,
  },
  skeletonLine: {
    height: 22,
    borderRadius: 8,
    backgroundColor: colors.line,
    width: '65%',
  },
  stamp: {
    position: 'absolute',
    top: 72,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 4,
    borderRadius: 6,
  },
  stampLike: {
    right: 28,
    borderColor: '#00C853',
  },
  stampNope: {
    left: 28,
    borderColor: colors.orange,
  },
  stampText: {
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 4,
  },
  stampTextLike: {
    color: '#00C853',
  },
  stampTextNope: {
    color: colors.orange,
  },
});
