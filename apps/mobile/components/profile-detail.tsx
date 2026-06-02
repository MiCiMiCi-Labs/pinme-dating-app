import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, IconButton, photos } from '@/design/system';
import { profileGallery, profileInterests } from '@/data/mock';

export function ProfileDetailContent() {
  const { height } = useWindowDimensions();
  const heroHeight = Math.min(height * 0.48, 390);

  return (
    <>
      <Pressable style={[styles.hero, { height: heroHeight }]} onPress={() => router.push('/(main)/profile/photos')}>
        <Image source={{ uri: photos.portrait }} style={styles.heroImage} contentFit="cover" />
        <IconButton
          icon="chevron-back"
          onPress={() => router.back()}
          style={styles.back}
        />
        <LinearGradient colors={['transparent', '#FFFFFF']} style={styles.fade} />
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable style={styles.smallAction}>
          <Ionicons name="close" size={28} color={colors.orange} />
        </Pressable>
        <Pressable style={styles.bigAction}>
          <Ionicons name="heart" size={42} color="#FFFFFF" />
        </Pressable>
        <Pressable style={styles.smallAction}>
          <Ionicons name="star" size={28} color={colors.purple} />
        </Pressable>
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <View>
            <Text style={styles.name}>Jessica Parker, 23</Text>
            <Text style={styles.role}>Professional model</Text>
          </View>
          <IconButton icon="paper-plane-outline" />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.distance}>
            <Ionicons name="location-outline" size={13} color={colors.primary} />
            <Text style={styles.distanceText}>1 km</Text>
          </View>
        </View>
        <Text style={styles.bodyText}>Chicago, IL United States</Text>

        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.bodyText}>
          My name is Jessica Parker and I enjoy meeting new people and finding ways to help them
          have an uplifting experience. I enjoy reading..
        </Text>
        <Text style={styles.readMore}>Read more</Text>

        <Text style={styles.sectionTitle}>Interests</Text>
        <View style={styles.interests}>
          {profileInterests.map((item, index) => (
            <View key={item} style={[styles.interest, index < 2 && styles.interestActive]}>
              {index < 2 ? <Ionicons name="checkmark" size={14} color={colors.primary} /> : null}
              <Text style={[styles.interestText, index < 2 && styles.interestTextActive]}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.galleryHeader}>
          <Text style={styles.sectionTitle}>Gallery</Text>
          <Pressable onPress={() => router.push('/(main)/profile/photos')}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        <View style={styles.gallery}>
          {profileGallery.map((image, index) => (
            <Pressable
              key={image}
              style={[styles.galleryImage, index < 2 && styles.galleryImageLarge]}
              onPress={() => router.push('/(main)/profile/photos')}
            >
              <Image source={{ uri: image }} style={styles.fillImage} contentFit="cover" />
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 330 },
  heroImage: { ...StyleSheet.absoluteFillObject },
  back: {
    position: 'absolute',
    top: 30,
    left: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 95 },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginTop: -56,
  },
  smallAction: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  bigAction: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 18,
  },
  info: { paddingHorizontal: 28, paddingTop: 28 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  name: { color: colors.text, fontSize: 25, fontWeight: '900' },
  role: { color: colors.muted, marginTop: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 22,
    marginBottom: 8,
  },
  distance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    height: 32,
  },
  distanceText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  bodyText: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  readMore: { color: colors.primary, fontSize: 14, fontWeight: '900', marginTop: 8 },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  interest: {
    height: 34,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  interestActive: { borderColor: colors.primary },
  interestText: { color: colors.text, fontSize: 13 },
  interestTextActive: { color: colors.primary, fontWeight: '700' },
  galleryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { color: colors.primary, fontWeight: '800', marginTop: 16 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryImage: { width: '30.6%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden' },
  galleryImageLarge: { width: '48%', aspectRatio: 0.78 },
  fillImage: { width: '100%', height: '100%' },
});
