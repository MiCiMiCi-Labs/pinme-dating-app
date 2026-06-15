import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, IconButton } from '@/design/system';
import { type Photo, type PublicUser } from '@/lib/api';

export function PhotoCarousel({ photos, height }: { photos: Photo[]; height: number }) {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);

  const handleTap = (side: 'left' | 'right') => {
    const total = photos.length;
    if (total <= 1) return;
    const next = side === 'right'
      ? Math.min(indexRef.current + 1, total - 1)
      : Math.max(indexRef.current - 1, 0);
    indexRef.current = next;
    setIndex(next);
  };

  const current = photos[index];

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
  const p = user?.profile;

  const badges = [
    p?.height         ? { emoji: '📏', label: `${p.height} cm` }                        : null,
    p?.education      ? { emoji: '🎓', label: p.education }                             : null,
    p?.relationshipGoal ? { emoji: '💛', label: GOAL_LABELS[p.relationshipGoal] ?? p.relationshipGoal } : null,
    p?.mbti           ? { emoji: '🧠', label: p.mbti }                                  : null,
    p?.constellation  ? { emoji: '✨', label: p.constellation }                         : null,
    p?.drinking       ? { emoji: '🍷', label: p.drinking }                              : null,
    p?.smoking        ? { emoji: '🚬', label: p.smoking }                               : null,
  ].filter(Boolean) as { emoji: string; label: string }[];

  return (
    <>
      <View style={styles.info}>
        <Text style={styles.name}>
          {user ? `${user.name}, ${user.age}` : '—'}
        </Text>
        <Text style={styles.role}>
          {p?.jobTitle ?? user?.city ?? ''}
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

        {p?.prompt1 ? (
          <>
            <Text style={styles.sectionTitle}>A perfect weekend is…</Text>
            <Text style={styles.bodyText}>{p.prompt1}</Text>
          </>
        ) : null}

        {p?.prompt2 ? (
          <>
            <Text style={styles.sectionTitle}>I get along best with…</Text>
            <Text style={styles.bodyText}>{p.prompt2}</Text>
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
});
