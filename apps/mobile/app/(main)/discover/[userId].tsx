import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhotoCarousel, ProfileDetailContent, ProfilePreviewHeader } from '@/components/profile-detail';
import { colors } from '@/design/system';
import {
  blockUser as blockUserApi,
  createSwipe,
  getMatchProfile,
  getUserById,
  isMatchLimitError,
  reportUser as reportUserApi,
  type DiscoveryUser,
  type PublicUser,
} from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { getCachedDiscoveryUser } from '@/lib/discovery-cache';
import { readCachedMatchedProfile, writeCachedMatchedProfile } from '@/lib/matchedProfileCache';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { confirmSwiped, markSwipedPending, unmarkSwipedIfPending } from '@/lib/swipedUsers';
import { useDislikeFromLikesList, useMatchFromLikesList } from '@/queries/chat.queries';
import { markDiscoveryNeedsRefresh } from '@/stores/discoveryUi.store';
import { markVoiceRoomNeedsRefresh } from '@/stores/voiceRoom.store';
import { showToast } from '@/stores/toast.store';

type ProfileDetailSource = 'discover' | 'likes' | 'matches' | 'preview';

function resolveSource(raw: string | undefined): ProfileDetailSource {
  return raw === 'likes' || raw === 'matches' || raw === 'preview' ? raw : 'discover';
}

function cachedDiscoveryToPublicUser(user: DiscoveryUser | null): PublicUser | null {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    age: user.age,
    gender: user.gender,
    bio: null,
    city: user.city,
    profile: null,
    photos: user.photos,
  };
}

function buildParamPreviewUser(params: {
  userId?: string;
  name?: string;
  age?: string;
  city?: string;
  gender?: string;
  photoUrl?: string;
}): PublicUser | null {
  if (!params.userId || !params.name) return null;

  const age = Number(params.age);
  return {
    id: params.userId,
    name: params.name,
    age: Number.isFinite(age) ? age : 0,
    gender: params.gender ?? '',
    bio: null,
    city: params.city ?? null,
    profile: null,
    photos: params.photoUrl
      ? [
          {
            id: `${params.userId}-preview-photo`,
            url: params.photoUrl,
            thumbnailUrl: params.photoUrl,
            isPrimary: true,
            isVerified: false,
            orderIndex: 0,
          },
        ]
      : [],
  };
}

export default function ProfileDetailScreen() {
  const {
    userId,
    matchId,
    source: rawSource,
    name,
    age,
    city,
    gender,
    photoUrl,
  } = useLocalSearchParams<{
    userId: string;
    matchId?: string;
    source?: string;
    name?: string;
    age?: string;
    city?: string;
    gender?: string;
    photoUrl?: string;
  }>();
  const source = resolveSource(rawSource);
  const navigation = useNavigation();
  const { session } = useAuth();
  const likeFromLikesMutation = useMatchFromLikesList();
  const dislikeFromLikesMutation = useDislikeFromLikesList();
  const cachedUser = getCachedDiscoveryUser(userId);
  const initialUser =
    cachedDiscoveryToPublicUser(cachedUser) ??
    buildParamPreviewUser({ userId, name, age, city, gender, photoUrl });
  const [user, setUser] = useState<PublicUser | null>(() => initialUser);
  const [loading, setLoading] = useState(!initialUser);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [disliking, setDisliking] = useState(false);
  const [stamp, setStamp] = useState<'like' | 'nope' | null>(null);
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(1.4)).current;
  const { height } = useWindowDimensions();
  const carouselHeight = Math.min(height * 0.55, 440);
  const isPreview = source === 'preview';

  useEffect(() => {
    const parent = navigation.getParent();
    parent?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => {
      parent?.setOptions({
        tabBarStyle: {
          height: 84,
          borderTopWidth: 0,
          backgroundColor: '#FFFFFF',
          elevation: 0,
          shadowOpacity: 0,
        },
      });
    };
  }, [navigation]);

  useEffect(() => {
    let cancelled = false;

    async function loadMatchedCache() {
      const viewerId = session?.user.id;
      if (source !== 'matches' || !viewerId || !matchId) return;

      const cached = await readCachedMatchedProfile(viewerId, matchId);
      if (!cached || cancelled) return;

      setUser(cached);
      setLoading(false);
    }

    loadMatchedCache();

    return () => {
      cancelled = true;
    };
  }, [matchId, session?.user.id, source]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId || !session?.access_token) return;
      try {
        const { user: data } =
          source === 'matches' && matchId
            ? await getMatchProfile(session.access_token, matchId)
            : await getUserById(session.access_token, userId);
        if (!cancelled) {
          setUser(data);
          if (source === 'matches' && matchId && session.user.id) {
            writeCachedMatchedProfile(session.user.id, matchId, data);
          }
        }
      } catch (err) {
        console.error('[ProfileDetail] getUserById failed:', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [matchId, session?.access_token, source, userId]);

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
            if (isMatchLimitError(err)) {
              Alert.alert(
                'Match limit reached',
                err instanceof Error ? err.message : 'Unmatch someone to keep matching.',
                [
                  { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
                  { text: 'Manage matches', onPress: () => router.replace('/(main)/matches') },
                ]
              );
              return;
            }
            showToast(err instanceof Error ? err.message : 'Failed to like user.', 'error');
            router.back();
          },
        });
      });
      return;
    }

    // source === 'discover'
    markSwipedPending(user.id);
    markDiscoveryNeedsRefresh();

    const apiPromise = (async () => {
      if (!session?.access_token) {
        unmarkSwipedIfPending(user.id);
        return null;
      }
      try {
        const result = await createSwipe(session.access_token, user.id, 'LIKE');
        confirmSwiped(user.id);
        return result;
      } catch (error) {
        // Never recorded server-side — don't keep this person hidden for
        // the rest of the session over a request that didn't go through.
        unmarkSwipedIfPending(user.id);
        if (isMatchLimitError(error)) {
          return error;
        }
        return null;
      }
    })();

    showStamp('like', async () => {
      const result = await apiPromise;
      if (isMatchLimitError(result)) {
        Alert.alert(
          'Match limit reached',
          result instanceof Error ? result.message : 'Unmatch someone to keep matching.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => router.back() },
            { text: 'Manage matches', onPress: () => router.replace('/(main)/matches') },
          ]
        );
        return;
      }
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
    markSwipedPending(user.id);
    markDiscoveryNeedsRefresh();
    const uid = user.id;
    if (session?.access_token) {
      createSwipe(session.access_token, uid, 'DISLIKE')
        .then(() => confirmSwiped(uid))
        .catch(() => unmarkSwipedIfPending(uid));
    } else {
      unmarkSwipedIfPending(uid);
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
              confirmSwiped(user.id);
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
        <View style={[styles.skeletonHero, { height: carouselHeight }]}>
          <Pressable style={styles.loadingBackButton} onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.loadingBackText}>‹</Text>
          </Pressable>
        </View>
        <View style={styles.skeletonBody}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingTitle}>Loading profile...</Text>
          <Text style={styles.loadingCopy}>Getting the latest profile details.</Text>
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
          {isPreview ? (
            <ProfilePreviewHeader
              onClose={() => router.back()}
              onEdit={() => router.replace('/(main)/profile')}
            />
          ) : null}
          <PhotoCarousel
            photos={photos}
            height={carouselHeight}
            onMorePress={isPreview ? undefined : openSafetyMenu}
            onBackPress={isPreview ? undefined : () => router.back()}
          />
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
          preview={isPreview}
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
  loadingBackButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  loadingBackText: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '500',
  },
  skeletonBody: {
    paddingHorizontal: 28,
    paddingTop: 32,
    alignItems: 'center',
    gap: 10,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },
  loadingCopy: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
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
