import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { ProfileDetailContent } from '@/components/profile-detail';
import { colors } from '@/design/system';
import { createSwipe, getUserById, type PublicUser } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function ProfileDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const { user: data } = await getUserById(session.access_token, userId);
        if (!cancelled) setUser(data);
      } catch {
        // keep null — ProfileDetailContent handles missing state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const handleLike = async () => {
    if (!user || liked) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const { match } = await createSwipe(session.access_token, user.id, 'LIKE');
      setLiked(true);
      if (match) {
        const primaryPhoto = (user.photos.find(p => p.isPrimary) ?? user.photos[0])?.url ?? '';
        Alert.alert("It's a match! 🎉", `You and ${user.name} liked each other`, [
          { text: 'Keep browsing', style: 'cancel' },
          {
            text: 'Say hello',
            onPress: () => router.push({
              pathname: '/(main)/chats/[matchId]',
              params: { matchId: match.id, name: user.name, photoUrl: primaryPhoto },
            }),
          },
        ]);
      }
    } catch {
      // 409 = already swiped, treat as liked
      setLiked(true);
    }
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <ProfileDetailContent user={user} onLike={handleLike} liked={liked} />
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
  content: {
    paddingBottom: 28,
  },
});
