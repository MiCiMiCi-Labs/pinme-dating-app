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
  const profile = user?.profile;
  const prompts = [
    { question: profile?.prompt1Question ?? 'A little more about me', answer: profile?.prompt1 },
    { question: profile?.prompt2Question ?? 'You should know', answer: profile?.prompt2 },
    { question: profile?.prompt3Question ?? 'Message me if', answer: profile?.prompt3 },
  ].filter((prompt) => prompt.answer?.trim());

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

        {profile ? (
          <>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.infoGrid}>
              <InfoPill label="Pronouns" value={profile.pronouns} />
              <InfoPill label="Orientation" value={profile.sexualOrientation} />
              <InfoPill label="Height" value={profile.height ? `${profile.height} cm` : null} />
              <InfoPill label="Job" value={profile.jobTitle} />
              <InfoPill label="Company" value={profile.company} />
              <InfoPill label="Education" value={profile.educationLevel ?? profile.education} />
              <InfoPill label="Hometown" value={profile.hometown} />
              <InfoPill label="Star sign" value={profile.constellation} />
              <InfoPill label="MBTI" value={profile.mbti} />
            </View>

            <Text style={styles.sectionTitle}>Lifestyle</Text>
            <View style={styles.infoGrid}>
              <InfoPill label="Smoking" value={profile.smoking} />
              <InfoPill label="Drinking" value={profile.drinking} />
              <InfoPill label="Exercise" value={profile.exercise} />
              <InfoPill label="Diet" value={profile.dietary} />
              <InfoPill label="Drugs" value={profile.drugs} />
              <InfoPill label="Pets" value={profile.pets} />
              <InfoPill label="Sleep" value={profile.sleepHabit} />
              <InfoPill label="Social" value={profile.socialHabit} />
            </View>

            <Text style={styles.sectionTitle}>Relationship and future</Text>
            <View style={styles.infoGrid}>
              <InfoPill label="Children" value={profile.children} />
              <InfoPill label="Wants children" value={profile.wantsChildren} />
              <InfoPill label="Relationship style" value={profile.relationshipStyle} />
              <InfoPill label="Communication" value={profile.communicationStyle} />
            </View>
          </>
        ) : null}

        {profile?.idealFirstDate ? (
          <>
            <Text style={styles.sectionTitle}>Ideal first date</Text>
            <Text style={styles.bodyText}>{profile.idealFirstDate}</Text>
          </>
        ) : null}

        {profile?.interests?.length ? (
          <>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.chipRow}>
              {profile.interests.map((interest) => (
                <Text key={interest} style={styles.chip}>{interest}</Text>
              ))}
            </View>
          </>
        ) : null}

        {profile?.languages?.length ? (
          <>
            <Text style={styles.sectionTitle}>Languages</Text>
            <View style={styles.chipRow}>
              {profile.languages.map((language) => (
                <Text key={language} style={styles.chip}>{language}</Text>
              ))}
            </View>
          </>
        ) : null}

        {profile?.weekend ? (
          <>
            <Text style={styles.sectionTitle}>Ideal weekend</Text>
            <Text style={styles.bodyText}>{profile.weekend}</Text>
          </>
        ) : null}

        {profile?.favorites ? (
          <>
            <Text style={styles.sectionTitle}>Favorites</Text>
            <Text style={styles.bodyText}>{profile.favorites}</Text>
          </>
        ) : null}

        {prompts.length ? (
          <>
            <Text style={styles.sectionTitle}>Prompts</Text>
            {prompts.map((prompt) => (
              <View key={prompt.question} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.bodyText}>{prompt.answer}</Text>
              </View>
            ))}
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

function InfoPill({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;

  return (
    <View style={styles.infoPill}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoPill: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  infoLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  infoValue: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    overflow: 'hidden',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  promptCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  promptQuestion: { color: colors.text, fontSize: 14, fontWeight: '900', marginBottom: 6 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryImage: { width: '30.6%', aspectRatio: 1, borderRadius: 6, overflow: 'hidden' },
  galleryImageLarge: { width: '48%', aspectRatio: 0.78 },
  fillImage: { width: '100%', height: '100%' },
});
