import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, IconButton } from '@/design/system';
import { getChatMatches, type ChatMatch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function MatchesScreen() {
  const [matches, setMatches] = useState<ChatMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function load() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        if (!hasLoadedRef.current) setLoading(true);
        try {
          const data = await getMatches(session.access_token);
          if (!cancelled) {
            setMatches(data);
            hasLoadedRef.current = true;
          }
        } catch {
          // keep existing state
        } finally {
          if (!cancelled) {
            hasLoadedRef.current = true;
            setLoading(false);
          }
        }
      }

      load();
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <IconButton icon="options-outline" />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : matches.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptySubtext}>Keep swiping to find your match!</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>New matches</Text>
            <View style={styles.grid}>
              {matches.map(({ matchId, user }) => {
                const primaryPhoto = (user.photos.find(p => p.isPrimary) ?? user.photos[0])?.url ?? '';
                return (
                  <Pressable
                    key={matchId}
                    style={styles.card}
                    onPress={() => router.push({ pathname: '/(main)/discover/[userId]', params: { userId: user.id } })}
                  >
                    {primaryPhoto ? (
                      <Image source={{ uri: primaryPhoto }} style={styles.cardImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
                    )}
                    <View style={styles.cardFooter}>
                      <Text style={styles.cardName}>{user.name}</Text>
                      <Text style={styles.cardMeta}>{user.age}{user.city ? ` · ${user.city}` : ''}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
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
  loader: {
    marginTop: 60,
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
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    width: '47%',
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
