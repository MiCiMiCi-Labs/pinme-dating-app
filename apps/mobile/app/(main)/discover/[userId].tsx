import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, SafeAreaView, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { PhotoCarousel, ProfileDetailContent } from '@/components/profile-detail';
import { colors } from '@/design/system';
import { createSwipe, getUserById, type PublicUser } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { markSwiped } from '@/lib/swipedUsers';

export default function ProfileDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [stamp, setStamp] = useState<'like' | 'nope' | null>(null);
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(1.4)).current;
  const { height } = useWindowDimensions();
  const carouselHeight = Math.min(height * 0.55, 440);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const { user: data } = await getUserById(session.access_token, userId);
        if (!cancelled) setUser(data);
      } catch (_) {
        // keep null — ProfileDetailContent handles missing state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

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
    if (!user || liked) return;
    setLiked(true);
    markSwiped(user.id);

    const apiPromise = (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
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
        const primaryPhoto = (user.photos.find(p => p.isPrimary) ?? user.photos[0])?.url ?? '';
        Alert.alert("It's a match! 🎉", `You and ${user.name} liked each other`, [
          { text: 'Keep browsing', onPress: () => router.back() },
          {
            text: 'Say hello',
            onPress: () => router.replace({
              pathname: '/(main)/chats/[matchId]',
              params: { matchId: match.id, name: user.name, photoUrl: primaryPhoto },
            }),
          },
        ]);
      } else {
        router.back();
      }
    });
  };

  const handleDislike = () => {
    if (!user) return;
    markSwiped(user.id);
    const uid = user.id;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) createSwipe(session.access_token, uid, 'DISLIKE').catch(() => {});
    });
    showStamp('nope', () => router.back());
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
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
          <PhotoCarousel photos={photos} height={carouselHeight} />
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
        <ProfileDetailContent user={user} onLike={handleLike} onDislike={handleDislike} liked={liked} />
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
