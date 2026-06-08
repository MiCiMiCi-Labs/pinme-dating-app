import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, PrimaryButton } from '@/design/system';
import { type DiscoveryUser } from '@/lib/api';

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
  const primaryPhoto = user.photos.find(p => p.isPrimary) ?? user.photos[0];
  const photoUrl = primaryPhoto?.url ?? '';

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

  return (
    <Animated.View
      {...panHandlers}
      style={[
        styles.card,
        { height },
        { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] },
      ]}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.cardImage} contentFit="cover" />
      ) : null}
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
        <Text style={styles.cardRole}>{user.profile?.jobTitle ?? user.city ?? ''}</Text>
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
      <Pressable style={styles.smallAction} onPress={onNope}>
        <Ionicons name="close" size={32} color={colors.orange} />
      </Pressable>
      <Pressable style={styles.bigAction} onPress={onLike}>
        <Ionicons name="heart" size={48} color="#FFFFFF" />
      </Pressable>
      <Pressable style={styles.smallAction}>
        <Ionicons name="star" size={32} color={colors.purple} />
      </Pressable>
    </View>
  );
}

export function FilterSheet({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.filterSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetTop}>
          <Text style={styles.filterTitle}>Filters</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        </View>
        <Text style={styles.filterLabel}>Interested in</Text>
        <View style={styles.segment}>
          {['Girls', 'Boys', 'Both'].map((item, index) => (
            <View key={item} style={[styles.segmentItem, index === 0 && styles.segmentActive]}>
              <Text style={[styles.segmentText, index === 0 && styles.segmentTextActive]}>{item}</Text>
            </View>
          ))}
        </View>
        <View style={styles.locationBox}>
          <Text style={styles.floatingLabel}>Location</Text>
          <Text style={styles.locationText}>Chicago, USA</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </View>
        <RangeRow label="Distance" value="40km" />
        <View style={styles.sliderTrack}>
          <View style={styles.sliderFill} />
          <View style={styles.sliderThumb} />
        </View>
        <RangeRow label="Age" value="20-28" />
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, styles.ageFill]} />
          <View style={[styles.sliderThumb, styles.ageThumbOne]} />
          <View style={[styles.sliderThumb, styles.ageThumbTwo]} />
        </View>
        <PrimaryButton onPress={onClose} style={styles.filterButton}>
          Continue
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
  const matchedPhoto = (matchedUser.photos.find(p => p.isPrimary) ?? matchedUser.photos[0])?.url ?? '';

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
    marginBottom: 34,
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
    marginBottom: 22,
  },
  rangeValue: { color: colors.muted, fontSize: 15 },
  sliderTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E7E7EC',
    marginBottom: 38,
  },
  sliderFill: { width: '50%', height: 5, borderRadius: 3, backgroundColor: colors.primary },
  sliderThumb: {
    position: 'absolute',
    left: '45%',
    top: -12,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  ageFill: { width: '38%', marginLeft: '10%' },
  ageThumbOne: { left: '8%' },
  ageThumbTwo: { left: '38%' },
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
});
