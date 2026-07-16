import { Ionicons } from '@expo/vector-icons';
import { useStore } from '@nanostores/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PaywallModal } from '@/components/paywall-modal';
import { colors } from '@/design/system';
import { getMatchProfile } from '@/lib/api';
import {
  getMatchedProfilePrefetchLimit,
  readCachedMatchedProfile,
  writeCachedMatchedProfile,
} from '@/lib/matchedProfileCache';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { useLikesPreview, useMatches } from '@/queries/chat.queries';
import { useMySubscription, useRedeemPromoCode } from '@/queries/subscription.queries';
import { $hiddenLikedUserIds } from '@/stores/likedYou.store';
import { $matchEvents, markMatchRefreshHandled } from '@/stores/matchEvents.store';
import { showToast } from '@/stores/toast.store';

function LikedYouTeaser({
  count,
  previewPhotos,
  loading,
  premium,
  onPress,
}: {
  count: number;
  previewPhotos: string[];
  loading: boolean;
  premium: boolean;
  onPress: () => void;
}) {
  const photosToShow = previewPhotos;
  const hasLikes = loading || count > 0 || photosToShow.length > 0;
  const countLabel = loading ? '...' : count > 99 ? '99+' : String(count);

  return (
    <Pressable
      style={styles.likedTeaser}
      onPress={hasLikes ? onPress : undefined}
    >
      <View style={styles.likedTeaserHeader}>
        <View>
          <Text style={styles.likedTeaserTitle}>People who liked you</Text>
          <Text style={styles.likedTeaserCopy}>
            {premium && hasLikes
              ? 'Premium is active. These people are already interested.'
              : hasLikes
              ? 'Unlock to see who is already interested.'
              : 'When someone likes you, they will appear here.'}
          </Text>
        </View>
        <View style={[styles.likedBadge, !hasLikes && styles.likedBadgeEmpty]}>
          <Ionicons name={premium ? 'sparkles' : 'lock-closed'} size={14} color="#FFFFFF" />
          <Text style={styles.likedBadgeText}>{countLabel}</Text>
        </View>
      </View>

      {hasLikes ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.likedPreviewRow}
        >
          {photosToShow.map((photo, index) => (
            <View key={`${photo}-${index}`} style={[styles.likedPreviewCard, index === 1 && styles.likedPreviewCardRaised]}>
              <Image
                source={{ uri: photo }}
                style={styles.likedPreviewImage}
                contentFit="cover"
                blurRadius={28}
              />
              <View style={styles.likedPreviewOverlay}>
                <Ionicons name="heart" size={22} color="#FFFFFF" />
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.likedEmptyPreview}>
          <Ionicons name="heart-outline" size={26} color={colors.primary} />
          <Text style={styles.likedEmptyText}>No secret likes yet</Text>
        </View>
      )}

      {hasLikes ? (
        <View style={styles.likedTeaserFooter}>
          <Text style={styles.likedFooterText}>
            {premium ? 'View secret admirers' : 'Unlock secret admirers'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function MatchesScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallError, setPaywallError] = useState<string | null>(null);
  const [secondaryQueriesEnabled, setSecondaryQueriesEnabled] = useState(false);
  const { data, isLoading, refetch } = useMatches();
  const likesPreviewQuery = useLikesPreview(secondaryQueriesEnabled);
  const subscriptionQuery = useMySubscription(secondaryQueriesEnabled);
  const redeemPromoMutation = useRedeemPromoCode();
  const hiddenLikedUserIds = useStore($hiddenLikedUserIds);
  const matches = Array.isArray(data) ? data : [];
  const likesPreview = likesPreviewQuery.data;
  const visiblePreview = likesPreview?.preview.filter(item => !hiddenLikedUserIds.has(item.userId)) ?? [];
  const hiddenCount = likesPreview?.preview.filter(item => hiddenLikedUserIds.has(item.userId)).length ?? 0;
  const likedPreviewPhotos = visiblePreview.map(item => item.thumbnailUrl || item.photoUrl);
  const visibleLikesCount = Math.max(0, (likesPreview?.count ?? 0) - hiddenCount);
  const premium = Boolean(subscriptionQuery.data?.subscription?.isActive);

  useEffect(() => {
    const timer = setTimeout(() => setSecondaryQueriesEnabled(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function prefetchMatchedProfiles() {
      if (!matches.length) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !session.user.id || cancelled) return;

      const matchesToPrefetch = matches.slice(0, getMatchedProfilePrefetchLimit());

      for (const match of matchesToPrefetch) {
        if (cancelled) return;

        const cached = await readCachedMatchedProfile(session.user.id, match.matchId);
        if (cached) continue;

        try {
          const { user } = await getMatchProfile(session.access_token, match.matchId);
          await writeCachedMatchedProfile(session.user.id, match.matchId, user);
        } catch {
          // Prefetch failures should never block the match list.
        }
      }
    }

    prefetchMatchedProfiles();

    return () => {
      cancelled = true;
    };
  }, [matches]);

  const handleLikedTeaserPress = () => {
    if (premium) {
      router.push('/(main)/matches/likes');
      return;
    }
    setPaywallError(null);
    setPaywallVisible(true);
  };

  const redeemPromoCode = async (code: string) => {
    setPaywallError(null);
    try {
      await redeemPromoMutation.mutateAsync(code);
      setPaywallVisible(false);
      showToast('Premium unlocked', 'success');
    } catch (error) {
      setPaywallError(error instanceof Error ? error.message : 'Failed to apply promo code');
    }
  };

  useEffect(() => {
    const unsubscribe = $matchEvents.subscribe((events) => {
      if (!events.pendingMatchRefresh || !events.latestMatch) return;
      showToast(`You matched with ${events.latestMatch.userName}`, 'success');
      refetch();
      markMatchRefreshHandled();
    });

    return unsubscribe;
  }, [refetch]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
      </View>
      <FlatList
        data={matches}
        keyExtractor={({ matchId }) => matchId}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await refetch();
          setRefreshing(false);
        }}
        contentContainerStyle={styles.content}
        columnWrapperStyle={styles.row}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        renderItem={({ item: { matchId, user } }) => {
          const primary = user.photos.find(p => p.isPrimary) ?? user.photos[0];
          const primaryPhotoUrl = primary ? getDisplayPhotoUrl(primary, 'thumbnail') : '';
          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push({
                pathname: '/(main)/matches/[userId]',
                params: {
                  userId: user.id,
                  matchId,
                  source: 'matches',
                  name: user.name,
                  age: String(user.age),
                  city: user.city ?? '',
                  gender: user.gender,
                  photoUrl: primaryPhotoUrl,
                },
              })}
            >
              {primaryPhotoUrl ? (
                <Image source={{ uri: primaryPhotoUrl }} style={styles.cardImage} contentFit="cover" />
              ) : (
                <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
              )}
              <View style={styles.cardFooter}>
                <Text style={styles.cardName}>{user.name}</Text>
                <Text style={styles.cardMeta}>{user.age}{user.city ? ` · ${user.city}` : ''}</Text>
              </View>
            </Pressable>
          );
        }}
        ListHeaderComponent={
          <>
            <LikedYouTeaser
              count={visibleLikesCount}
              previewPhotos={likedPreviewPhotos}
              loading={!secondaryQueriesEnabled || likesPreviewQuery.isLoading}
              premium={premium}
              onPress={handleLikedTeaserPress}
            />
            <Text style={styles.sectionTitle}>New matches</Text>
          </>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No matches yet</Text>
              <Text style={styles.emptySubtext}>Keep swiping to find your match!</Text>
            </View>
          )
        }
      />
      <PaywallModal
        visible={paywallVisible}
        loading={redeemPromoMutation.isPending}
        error={paywallError}
        onClose={() => setPaywallVisible(false)}
        onRedeem={redeemPromoCode}
      />
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
  teaserWrap: {
    paddingHorizontal: 28,
  },
  row: {
    gap: 14,
  },
  rowGap: {
    height: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 16,
  },
  likedTeaser: {
    marginTop: 8,
    marginBottom: 2,
    borderRadius: 22,
    padding: 16,
    backgroundColor: '#FFF4F6',
    borderWidth: 1,
    borderColor: '#F8D7DE',
    overflow: 'hidden',
  },
  likedTeaserHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  likedTeaserTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  likedTeaserCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    maxWidth: 210,
  },
  likedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primary,
  },
  likedBadgeEmpty: {
    backgroundColor: colors.grayIcon,
  },
  likedBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  likedPreviewRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  likedPreviewCard: {
    width: 86,
    height: 86,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.line,
  },
  likedPreviewCardRaised: {
    transform: [{ translateY: -6 }],
  },
  likedPreviewImage: {
    width: '100%',
    height: '100%',
  },
  likedPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,17,22,0.36)',
  },
  likedEmptyPreview: {
    marginTop: 16,
    minHeight: 78,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#F3C7D0',
    backgroundColor: 'rgba(255,255,255,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  likedEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  likedTeaserFooter: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(230,76,97,0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  likedFooterText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
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
  card: {
    flex: 1,
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
