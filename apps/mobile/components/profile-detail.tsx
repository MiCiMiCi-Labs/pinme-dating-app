import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, IconButton } from '@/design/system';
import { type PublicUser } from '@/lib/api';

export function ProfileDetailContent({ user }: { user: PublicUser | null }) {
  const { height } = useWindowDimensions();
  const heroHeight = Math.min(height * 0.48, 390);

  const primaryPhoto = user ? (user.photos.find(p => p.isPrimary) ?? user.photos[0]) : null;
  const galleryPhotos = user ? user.photos.slice(0, 5) : [];

  return (
    <>
      <Pressable style={[styles.hero, { height: heroHeight }]}>
        {primaryPhoto ? (
          <Image source={{ uri: primaryPhoto.url }} style={styles.heroImage} contentFit="cover" />
        ) : null}
        <IconButton
          icon="chevron-back"
          onPress={() => router.back()}
          style={styles.back}
        />
        <LinearGradient colors={['transparent', '#FFFFFF']} style={styles.fade} />
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable style={styles.smallAction} onPress={() => router.back()}>
          <Ionicons name="close" size={28} color={colors.orange} />
        </Pressable>
        {/* Chat button — placeholder for Mia's chat feature */}
        <Pressable style={styles.bigAction} onPress={() => { /* TODO: navigate to chat */ }}>
          <Ionicons name="chatbubble-ellipses" size={36} color="#FFFFFF" />
        </Pressable>
        <Pressable style={styles.smallAction}>
          <Ionicons name="heart" size={28} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <View>
            <Text style={styles.name}>
              {user ? `${user.name}, ${user.age}` : '—'}
            </Text>
            <Text style={styles.role}>
              {user?.profile?.jobTitle ?? user?.city ?? ''}
            </Text>
          </View>
        </View>

        {user?.city ? (
          <>
            <Text style={styles.sectionTitle}>Location</Text>
            <Text style={styles.bodyText}>{user.city}</Text>
          </>
        ) : null}

        {user?.bio ? (
          <>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bodyText}>{user.bio}</Text>
          </>
        ) : null}

        {user?.profile?.prompt1 ? (
          <>
            <Text style={styles.sectionTitle}>A perfect weekend is…</Text>
            <Text style={styles.bodyText}>{user.profile.prompt1}</Text>
          </>
        ) : null}

        {user?.profile?.prompt2 ? (
          <>
            <Text style={styles.sectionTitle}>I get along best with…</Text>
            <Text style={styles.bodyText}>{user.profile.prompt2}</Text>
          </>
        ) : null}

        {galleryPhotos.length > 1 ? (
          <>
            <Text style={styles.sectionTitle}>Photos</Text>
            <View style={styles.gallery}>
              {galleryPhotos.slice(1).map((photo, index) => (
                <View
                  key={photo.id}
                  style={[styles.galleryImage, index < 2 && styles.galleryImageLarge]}
                >
                  <Image source={{ uri: photo.url }} style={styles.fillImage} contentFit="cover" />
                </View>
              ))}
            </View>
          </>
        ) : null}
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
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 22,
    marginBottom: 8,
  },
  bodyText: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryImage: { width: '30.6%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden' },
  galleryImageLarge: { width: '48%', aspectRatio: 0.78 },
  fillImage: { width: '100%', height: '100%' },
});
