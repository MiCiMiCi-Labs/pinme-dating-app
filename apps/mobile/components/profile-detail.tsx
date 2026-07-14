import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, IconButton } from '@/design/system';
import { type Photo, type PublicUser } from '@/lib/api';

export function PhotoCarousel({
  photos,
  height,
  onMorePress,
}: {
  photos: Photo[];
  height: number;
  onMorePress?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const current = photos[index] ?? null;

  function handleTap(side: 'left' | 'right') {
    const next = side === 'left'
      ? Math.max(0, indexRef.current - 1)
      : Math.min(photos.length - 1, indexRef.current + 1);
    indexRef.current = next;
    setIndex(next);
  }

  return (
    <View style={{ height }}>
      {current ? (
        <Image source={{ uri: current.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noPhoto]} />
      )}

      {photos.length > 1 && (
        <>
          <View style={styles.progressBars}>
            {photos.map((_, i) => (
              <View key={i} style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, i <= index && styles.progressBarActive]} />
              </View>
            ))}
          </View>
          <View style={[StyleSheet.absoluteFill, styles.tapZones]} pointerEvents="box-none">
            <Pressable style={styles.tapLeft} onPress={() => handleTap('left')} />
            <Pressable style={styles.tapRight} onPress={() => handleTap('right')} />
          </View>
        </>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.85)', '#FFFFFF']}
        style={styles.fade}
      />
      <IconButton icon="chevron-back" onPress={() => router.back()} style={styles.back} />
      {onMorePress ? (
        <IconButton icon="ellipsis-horizontal" onPress={onMorePress} style={styles.more} />
      ) : null}
    </View>
  );
}

const GOAL_LABELS: Record<string, string> = {
  CASUAL: 'Casual dating',
  SERIOUS: 'Serious relationship',
  FRIENDSHIP: 'Friendship',
  UNDECIDED: 'Still figuring out',
};

function Badge({ emoji, label }: { emoji: string; label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeEmoji}>{emoji}</Text>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export function ProfileDetailContent({ user, onLike, onDislike, liked }: { user: PublicUser | null; onLike?: () => void; onDislike?: () => void; liked?: boolean }) {
  const profile = user?.profile;

  const badges = [
    profile?.height         ? { emoji: '📏', label: `${profile.height} cm` }                              : null,
    profile?.education      ? { emoji: '🎓', label: profile.education }                                   : null,
    profile?.relationshipGoal ? { emoji: '💛', label: GOAL_LABELS[profile.relationshipGoal] ?? profile.relationshipGoal } : null,
    profile?.mbti           ? { emoji: '🧠', label: profile.mbti }                                        : null,
    profile?.constellation  ? { emoji: '✨', label: profile.constellation }                               : null,
    profile?.drinking       ? { emoji: '🍷', label: profile.drinking }                                    : null,
    profile?.smoking        ? { emoji: '🚬', label: profile.smoking }                                     : null,
  ].filter(Boolean) as { emoji: string; label: string }[];

  const prompts = [
    { question: profile?.prompt1Question ?? 'A little more about me', answer: profile?.prompt1 },
    { question: profile?.prompt2Question ?? 'You should know', answer: profile?.prompt2 },
    { question: profile?.prompt3Question ?? 'Message me if', answer: profile?.prompt3 },
  ].filter((prompt) => prompt.answer?.trim());

  return (
    <>
      <View style={styles.info}>
        <Text style={styles.name}>
          {user ? `${user.name}, ${user.age}` : '—'}
        </Text>
        <Text style={styles.role}>
          {profile?.jobTitle ?? user?.city ?? ''}
        </Text>

        {badges.length > 0 && (
          <View style={styles.badges}>
            {badges.map((b, i) => <Badge key={i} emoji={b.emoji} label={b.label} />)}
          </View>
        )}

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
            {prompts.map((prompt, i) => (
              <View key={i} style={styles.promptCard}>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
                <Text style={styles.bodyText}>{prompt.answer}</Text>
              </View>
            ))}
          </>
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.smallAction} onPress={onDislike ?? (() => router.back())}>
          <Ionicons name="close" size={28} color={colors.orange} />
        </Pressable>
        <Pressable style={styles.bigAction} onPress={() => { /* TODO: navigate to chat */ }}>
          <Ionicons name="chatbubble-ellipses" size={36} color="#FFFFFF" />
        </Pressable>
        <Pressable style={[styles.smallAction, liked && styles.smallActionActive]} onPress={onLike}>
          <Ionicons name="heart" size={28} color={liked ? '#FFFFFF' : colors.primary} />
        </Pressable>
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
  noPhoto: {
    backgroundColor: colors.line,
  },
  back: {
    position: 'absolute',
    top: 30,
    left: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  more: {
    position: 'absolute',
    top: 30,
    right: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.32)',
  },
  progressBars: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
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
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 },
  tapZones: { flexDirection: 'row' },
  tapLeft: { flex: 1 },
  tapRight: { flex: 1 },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingTop: 32,
    paddingBottom: 48,
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
  smallActionActive: {
    backgroundColor: colors.primary,
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
  name: { color: colors.text, fontSize: 25, fontWeight: '900' },
  role: { color: colors.muted, marginTop: 4 },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
  },
  badgeEmoji: { fontSize: 14 },
  badgeText: { color: colors.text, fontSize: 13, fontWeight: '600' },
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
