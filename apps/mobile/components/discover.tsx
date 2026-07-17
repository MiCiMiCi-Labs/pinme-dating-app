import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, PrimaryButton, RoundActionButton } from '@/design/system';
import {
  getMyPreferences,
  getPrivacySettings,
  updateLocation,
  updateMyPreferences,
  updatePrivacySettings,
  type DiscoveryUser,
  type Preferences,
  type PrivacySettings,
} from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';

export function DiscoverCard({
  user,
  height,
  pan,
  panHandlers,
}: {
  user: DiscoveryUser;
  height: number;
  pan: Animated.ValueXY;
  panHandlers: object;
}) {
  const sortedPhotos = [
    ...user.photos.filter(p => p.isPrimary),
    ...user.photos.filter(p => !p.isPrimary).sort((a, b) => a.orderIndex - b.orderIndex),
  ];
  const [photoIndex, setPhotoIndex] = useState(0);
  const photoIndexRef = useRef(0);

  const currentPhoto = sortedPhotos[photoIndex];
  const currentPhotoUrl = currentPhoto ? getDisplayPhotoUrl(currentPhoto, 'thumbnail') : '';

  const rotate = pan.x.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: ['-15deg', '0deg', '15deg'],
    extrapolate: 'clamp',
  });

  const likeOpacity = pan.x.interpolate({
    inputRange: [20, 80],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const nopeOpacity = pan.x.interpolate({
    inputRange: [-80, -20],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const handleTap = (side: 'left' | 'right') => {
    const total = sortedPhotos.length;
    if (total <= 1) return;
    const next = side === 'right'
      ? Math.min(photoIndexRef.current + 1, total - 1)
      : Math.max(photoIndexRef.current - 1, 0);
    photoIndexRef.current = next;
    setPhotoIndex(next);
  };

  return (
    <Animated.View
      {...panHandlers}
      style={[
        styles.card,
        { height },
        { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
      ]}
    >
      {currentPhotoUrl ? (
        <Image source={{ uri: currentPhotoUrl }} style={styles.cardImage} contentFit="cover" />
      ) : null}

      {/* tap zones for photo navigation */}
      {sortedPhotos.length > 1 && (
        <View style={styles.tapZones} pointerEvents="box-none">
          <Pressable style={styles.tapLeft} onPress={() => handleTap('left')} />
          <Pressable style={styles.tapRight} onPress={() => handleTap('right')} />
        </View>
      )}

      {/* photo progress bars */}
      {sortedPhotos.length > 1 && (
        <View style={styles.progressBars}>
          {sortedPhotos.map((_, i) => (
            <View key={i} style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, i <= photoIndex && styles.progressBarActive]} />
            </View>
          ))}
        </View>
      )}

      {user.distanceKm ? (
        <View style={styles.distanceBadge}>
          <Ionicons name="location-outline" size={14} color="#FFFFFF" />
          <Text style={styles.distanceText}>{user.distanceKm}</Text>
        </View>
      ) : null}
      <View style={styles.sideGrip}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={styles.gripDot} />
        ))}
      </View>
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.82)']} style={styles.cardGradient}>
        <Text style={styles.cardName}>{user.name}, {user.age}</Text>
        <Text style={styles.cardRole}>{user.jobTitle ?? user.city ?? ''}</Text>
      </LinearGradient>
      <Animated.View style={[styles.feedbackLike, { opacity: likeOpacity }]}>
        <Ionicons name="heart" size={42} color={colors.primary} />
      </Animated.View>
      <Animated.View style={[styles.feedbackNope, { opacity: nopeOpacity }]}>
        <Ionicons name="close" size={42} color={colors.orange} />
      </Animated.View>
    </Animated.View>
  );
}

export function SwipeActions({ onNope, onLike }: { onNope: () => void; onLike: () => void }) {
  return (
    <View style={styles.actionRow}>
      <RoundActionButton icon="close" color={colors.orange} onPress={onNope} />
      <RoundActionButton icon="heart" filled size={102} iconSize={48} onPress={onLike} />
      <RoundActionButton icon="star" color={colors.purple} />
    </View>
  );
}

const GENDER_OPTIONS: Array<{ label: string; value: Preferences['preferredGender'] }> = [
  { label: 'Girls', value: 'FEMALE' },
  { label: 'Boys', value: 'MALE' },
  { label: 'Both', value: null },
];

const DISTANCE_OPTIONS = [10, 25, 50, 100, 200];
const MIN_AGE_OPTIONS = [18, 20, 22, 25, 28, 30];
const MAX_AGE_OPTIONS = [22, 25, 28, 30, 35, 40, 99];

export function FilterSheet({ onClose, onApply }: { onClose: () => void; onApply?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  const [preferredGender, setPreferredGender] = useState<Preferences['preferredGender']>(null);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(50);
  const [minAge, setMinAge] = useState<number>(18);
  const [maxAge, setMaxAge] = useState<number>(35);
  const [showDistance, setShowDistance] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      try {
        const [{ preferences }, privacy] = await Promise.all([
          getMyPreferences(session.access_token),
          getPrivacySettings(session.access_token),
        ]);
        if (preferences) {
          setPreferredGender(preferences.preferredGender);
          setMaxDistanceKm(preferences.maxDistanceKm ?? 50);
          setMinAge(preferences.minAge ?? 18);
          setMaxAge(preferences.maxAge ?? 99);
        }
        setShowDistance(privacy.showDistance);
      } catch (_) {}
      setLoading(false);
    }
    load();
  }, []);

  const requestLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [geo] = await Location.reverseGeocodeAsync(pos.coords).catch(() => [null]);
      const city = geo ? [geo.city, geo.country].filter(Boolean).join(', ') : undefined;
      if (city) setLocationLabel(city);

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await updateLocation(session.access_token, pos.coords.latitude, pos.coords.longitude, city);
      }
    } catch (_) {}
    setLocating(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await Promise.all([
          updateMyPreferences(session.access_token, { preferredGender, minAge, maxAge: maxAge === 99 ? null : maxAge, maxDistanceKm }),
          updatePrivacySettings(session.access_token, { showDistance }),
        ]);
        onApply?.();
        onClose();
      }
    } catch (_) {}
    setSaving(false);
  };

  const reset = async () => {
    setPreferredGender(null);
    setMaxDistanceKm(50);
    setMinAge(18);
    setMaxAge(35);
    setShowDistance(false);
  };

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.filterSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetTop}>
          <Text style={styles.filterTitle}>Filters</Text>
          <Pressable onPress={reset}>
            <Text style={styles.clear}>Reset</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />
        ) : (
          <>
            <Text style={styles.filterLabel}>Interested in</Text>
            <View style={styles.segment}>
              {GENDER_OPTIONS.map((opt) => {
                const active = preferredGender === opt.value;
                return (
                  <Pressable
                    key={opt.label}
                    style={[styles.segmentItem, active && styles.segmentActive]}
                    onPress={() => setPreferredGender(opt.value)}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable style={styles.locationBox} onPress={requestLocation} disabled={locating}>
              <Text style={styles.floatingLabel}>Location</Text>
              {locating ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.locationText}>{locationLabel ?? 'Tap to update'}</Text>
              )}
              <Ionicons name="location-outline" size={20} color={colors.primary} />
            </Pressable>

            <RangeRow label="Max distance" value={`${maxDistanceKm} km`} />
            <View style={styles.pillRow}>
              {DISTANCE_OPTIONS.map((d) => (
                <Pressable
                  key={d}
                  style={[styles.pill, maxDistanceKm === d && styles.pillActive]}
                  onPress={() => setMaxDistanceKm(d)}
                >
                  <Text style={[styles.pillText, maxDistanceKm === d && styles.pillTextActive]}>
                    {d} km
                  </Text>
                </Pressable>
              ))}
            </View>

            <RangeRow label="Min age" value={`${minAge}`} />
            <View style={styles.pillRow}>
              {MIN_AGE_OPTIONS.map((a) => (
                <Pressable
                  key={a}
                  style={[styles.pill, minAge === a && styles.pillActive]}
                  onPress={() => setMinAge(Math.min(a, maxAge))}
                >
                  <Text style={[styles.pillText, minAge === a && styles.pillTextActive]}>{a}</Text>
                </Pressable>
              ))}
            </View>

            <RangeRow label="Max age" value={maxAge === 99 ? 'Any' : `${maxAge}`} />
            <View style={styles.pillRow}>
              {MAX_AGE_OPTIONS.map((a) => (
                <Pressable
                  key={a}
                  style={[styles.pill, maxAge === a && styles.pillActive]}
                  onPress={() => setMaxAge(Math.max(a, minAge))}
                >
                  <Text style={[styles.pillText, maxAge === a && styles.pillTextActive]}>
                    {a === 99 ? 'Any' : a}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.filterLabel}>Show my distance</Text>
              <Switch
                value={showDistance}
                onValueChange={setShowDistance}
                trackColor={{ true: colors.primary }}
              />
            </View>
          </>
        )}

        <PrimaryButton onPress={saving ? undefined : save} style={styles.filterButton}>
          {saving ? 'Saving...' : 'Apply'}
        </PrimaryButton>
      </View>
    </View>
  );
}

export function MatchOverlay({
  matchedUser,
  myPhotoUrl,
  onKeepSwiping,
  onSayHello,
}: {
  matchedUser: DiscoveryUser;
  myPhotoUrl: string | null;
  onKeepSwiping: () => void;
  onSayHello: () => void;
}) {
  const primaryMatchedPhoto = matchedUser.photos.find(p => p.isPrimary) ?? matchedUser.photos[0];
  const matchedPhoto = primaryMatchedPhoto ? getDisplayPhotoUrl(primaryMatchedPhoto, 'thumbnail') : '';

  return (
    <View style={styles.matchOverlay}>
      <View style={styles.matchPhotos}>
        <Image
          source={{ uri: myPhotoUrl ?? matchedPhoto }}
          style={[styles.matchPhoto, styles.matchPhotoBack]}
          contentFit="cover"
        />
        <Image
          source={{ uri: matchedPhoto }}
          style={[styles.matchPhoto, styles.matchPhotoFront]}
          contentFit="cover"
        />
        <View style={[styles.matchHeart, styles.matchHeartTop]}>
          <Ionicons name="heart" size={28} color={colors.primary} />
        </View>
        <View style={[styles.matchHeart, styles.matchHeartBottom]}>
          <Ionicons name="heart" size={24} color={colors.primary} />
        </View>
      </View>
      <Text style={styles.matchTitle}>It's a match!</Text>
      <Text style={styles.matchCopy}>You and {matchedUser.name} liked each other</Text>
      <View style={styles.matchActions}>
        <PrimaryButton onPress={onSayHello}>Say hello</PrimaryButton>
        <PrimaryButton variant="soft" onPress={onKeepSwiping}>
          Keep swiping
        </PrimaryButton>
      </View>
    </View>
  );
}

export function DiscoverySkeleton({ height }: { height: number }) {
  const pulse = useRef(new Animated.Value(0.65)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.65, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.card, { height, opacity: pulse }]}>
      <View style={styles.skeletonTextBlock}>
        <View style={styles.skeletonName} />
        <View style={styles.skeletonRole} />
      </View>
    </Animated.View>
  );
}

function RangeRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rangeHeader}>
      <Text style={styles.filterLabel}>{label}</Text>
      <Text style={styles.rangeValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '78%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.line,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  cardImage: { ...StyleSheet.absoluteFillObject },
  tapZones: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  tapLeft: { flex: 1 },
  tapRight: { flex: 1 },
  progressBars: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    gap: 4,
  },
  progressBarTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  progressBarFill: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  progressBarActive: {
    backgroundColor: '#FFFFFF',
  },
  distanceBadge: {
    position: 'absolute',
    top: 20,
    left: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  distanceText: { color: '#FFFFFF', fontWeight: '700' },
  sideGrip: {
    position: 'absolute',
    right: 0,
    top: '40%',
    width: 22,
    height: 76,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  gripDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 132,
    justifyContent: 'flex-end',
    padding: 18,
  },
  cardName: { color: '#FFFFFF', fontSize: 25, fontWeight: '900' },
  cardRole: { color: '#FFFFFF', fontSize: 14, marginTop: 4 },
  feedbackLike: {
    position: 'absolute',
    top: 28,
    left: 18,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackNope: {
    position: 'absolute',
    top: 28,
    right: 18,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 8,
  },
  smallAction: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.07,
    shadowRadius: 22,
  },
  bigAction: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.28,
    shadowRadius: 20,
  },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  filterSheet: {
    minHeight: 620,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    backgroundColor: colors.bg,
    paddingHorizontal: 40,
    paddingTop: 34,
  },
  sheetHandle: {
    position: 'absolute',
    top: -6,
    alignSelf: 'center',
    width: 48,
    height: 10,
    borderRadius: 8,
    backgroundColor: colors.text,
  },
  sheetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 34,
  },
  filterTitle: { color: colors.text, fontSize: 28, fontWeight: '900' },
  clear: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  filterLabel: { color: colors.text, fontSize: 16, fontWeight: '900' },
  segment: {
    height: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    marginTop: 20,
    marginBottom: 38,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { color: colors.text, fontWeight: '700' },
  segmentTextActive: { color: '#FFFFFF' },
  locationBox: {
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  floatingLabel: {
    position: 'absolute',
    left: 22,
    top: -9,
    backgroundColor: colors.bg,
    color: '#B0B0B8',
    paddingHorizontal: 8,
    fontSize: 12,
  },
  locationText: { color: colors.text, fontSize: 15 },
  rangeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rangeValue: { color: colors.muted, fontSize: 15 },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  pillTextActive: { color: '#FFFFFF' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  filterButton: { marginTop: 12 },
  matchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  matchPhotos: { width: 250, height: 300, marginBottom: 36 },
  matchPhoto: {
    position: 'absolute',
    width: 145,
    height: 198,
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  matchPhotoBack: { right: 8, top: 10, transform: [{ rotate: '12deg' }] },
  matchPhotoFront: { left: 0, top: 92, transform: [{ rotate: '-10deg' }] },
  matchHeart: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
  },
  matchHeartTop: { top: 0, left: 98 },
  matchHeartBottom: { left: 26, bottom: 34 },
  matchTitle: { color: colors.primary, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  matchCopy: { color: colors.muted, marginTop: 10, marginBottom: 88, textAlign: 'center' },
  matchActions: { alignSelf: 'stretch', gap: 20 },
  skeletonTextBlock: {
    position: 'absolute',
    bottom: 22,
    left: 18,
    right: 18,
    gap: 8,
  },
  skeletonName: {
    height: 22,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.35)',
    width: '68%',
  },
  skeletonRole: {
    height: 14,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    width: '42%',
  },
});
