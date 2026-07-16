import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, IconButton, PillActionButton, RoundActionButton, TextButton } from '@/design/system';
import { type AppProfile, type Photo, type PublicUser } from '@/lib/api';
import { formatProfileValue, getVisibleProfileValue, hasMeaningfulValue } from '@/lib/profileDisplay';

type InfoItem = {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

type PromptItem = {
  question: string;
  answer: string;
};

export function PhotoCarousel({
  photos,
  height,
  onMorePress,
  onBackPress,
}: {
  photos: Photo[];
  height: number;
  onMorePress?: () => void;
  onBackPress?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = Math.max(0, windowWidth - 32);
  const currentIndex = Math.min(index, Math.max(photos.length - 1, 0));

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const width = event.nativeEvent.layoutMeasurement.width;
    if (!width) return;
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={[styles.photoShell, { height }]}>
      {photos.length ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          style={styles.photoPager}
        >
          {photos.map((photo) => (
            <View key={photo.id} style={[styles.photoPage, { width: pageWidth }]}>
              <Image source={{ uri: photo.url }} style={styles.photo} contentFit="cover" />
            </View>
          ))}
        </ScrollView>
      ) : (
        <EmptyPhotoPlaceholder />
      )}

      {photos.length > 1 ? (
        <View style={styles.photoDots}>
          {photos.map((photo, dotIndex) => (
            <Pressable
              key={photo.id}
              style={[styles.photoDot, dotIndex === currentIndex && styles.photoDotActive]}
              onPress={() => {
                scrollRef.current?.scrollTo({ x: dotIndex * pageWidth, animated: true });
                setIndex(dotIndex);
              }}
            />
          ))}
        </View>
      ) : null}

      <LinearGradient
        colors={['rgba(0,0,0,0.18)', 'transparent', 'rgba(0,0,0,0.5)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {onBackPress ? (
        <IconButton
          icon="chevron-back"
          onPress={onBackPress}
          color="#FFFFFF"
          style={styles.backButton}
        />
      ) : null}

      {onMorePress ? (
        <IconButton
          icon="ellipsis-horizontal"
          onPress={onMorePress}
          color="#FFFFFF"
          style={styles.moreButton}
        />
      ) : null}
    </View>
  );
}

export function EmptyPhotoPlaceholder() {
  return (
    <View style={styles.emptyPhoto}>
      <View style={styles.emptyPhotoIcon}>
        <Ionicons name="image-outline" size={30} color={colors.primary} />
      </View>
      <Text style={styles.emptyPhotoTitle}>No photo yet</Text>
      <Text style={styles.emptyPhotoText}>Photos will appear here once they are added.</Text>
    </View>
  );
}

export function ProfileDetailContent({
  user,
  onLike,
  onDislike,
  onMessage,
  liked,
  variant = 'discovery',
  preview = false,
}: {
  user: PublicUser | null;
  onLike?: () => void;
  onDislike?: () => void;
  onMessage?: () => void;
  liked?: boolean;
  variant?: 'discovery' | 'matched';
  preview?: boolean;
}) {
  const profile = user?.profile ?? null;
  const name = user?.name?.trim() || 'Profile';
  const heading = user ? `${name}${user.age ? `, ${user.age}` : ''}` : 'Profile';
  const relationshipGoal = formatProfileValue(profile?.relationshipGoal);
  const coreBadges = buildCoreBadges(profile);
  const prompts = buildPrompts(profile);
  const moreAbout = buildMoreAbout(profile, coreBadges.map(item => item.label));
  const lifestyle = buildLifestyle(profile);
  const relationshipRows = buildRelationshipRows(profile);
  const interests = profile?.interests?.filter(hasMeaningfulValue) ?? [];
  const languages = getVisibleProfileValue(profile, 'languages', profile?.languages ?? []);

  return (
    <>
      <View style={styles.content}>
        <ProfileHeader
          name={heading}
          city={user?.city}
          relationshipGoal={relationshipGoal}
        />

        {coreBadges.length ? (
          <View style={styles.badgeRow}>
            {coreBadges.map(item => (
              <ProfileBadge key={`${item.label}-${item.value}`} item={item} />
            ))}
          </View>
        ) : null}

        {hasMeaningfulValue(user?.bio) ? (
          <ProfileSection title={`About ${name}`}>
            <Text style={styles.bodyText}>{user?.bio?.trim()}</Text>
          </ProfileSection>
        ) : null}

        {prompts[0] ? <ProfilePromptCard prompt={prompts[0]} /> : null}

        {interests.length ? (
          <ProfileSection title="Interests">
            <View style={styles.chipRow}>
              {interests.map(interest => (
                <InterestChip key={interest} label={formatProfileValue(interest)} />
              ))}
            </View>
          </ProfileSection>
        ) : null}

        {prompts.slice(1).map(prompt => (
          <ProfilePromptCard key={`${prompt.question}-${prompt.answer}`} prompt={prompt} />
        ))}

        {moreAbout.length ? (
          <ProfileSection title={`More about ${name}`}>
            <ProfileInfoGrid items={moreAbout} />
          </ProfileSection>
        ) : null}

        {Array.isArray(languages) && languages.length ? (
          <ProfileSection title="Languages">
            <Text style={styles.compactLine}>{languages.map(formatProfileValue).join(' · ')}</Text>
          </ProfileSection>
        ) : null}

        {lifestyle.length ? (
          <ProfileSection title="Lifestyle">
            <View style={styles.rowCard}>
              {lifestyle.map((item, index) => (
                <ProfileInfoRow
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  isLast={index === lifestyle.length - 1}
                />
              ))}
            </View>
          </ProfileSection>
        ) : null}

        {relationshipRows.length ? (
          <ProfileSection title="Relationship goals">
            <View style={styles.rowCard}>
              {relationshipRows.map((item, index) => (
                <ProfileInfoRow
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  isLast={index === relationshipRows.length - 1}
                />
              ))}
            </View>
          </ProfileSection>
        ) : null}
      </View>

      {!preview && (
        variant === 'matched' ? (
          onMessage ? (
            <View style={styles.matchedAction}>
              <PillActionButton label="Message" icon="chatbubble-ellipses" onPress={onMessage} />
            </View>
          ) : null
        ) : (
          <View style={styles.actionRow}>
            <RoundActionButton icon="close" color={colors.orange} onPress={onDislike ?? (() => router.back())} />
            {onMessage ? (
              <RoundActionButton icon="chatbubble-ellipses" filled size={88} iconSize={32} onPress={onMessage} />
            ) : null}
            <RoundActionButton icon="heart" active={liked} iconSize={28} onPress={onLike} />
          </View>
        )
      )}
    </>
  );
}

export function ProfilePreviewHeader({
  onClose,
  onEdit,
}: {
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <View style={styles.previewHeader}>
      <IconButton icon="close" onPress={onClose} size={42} color={colors.text} style={styles.headerButton} />
      <Text style={styles.previewTitle}>Profile preview</Text>
      <TextButton onPress={onEdit}>Edit</TextButton>
    </View>
  );
}

function ProfileHeader({
  name,
  city,
  relationshipGoal,
}: {
  name: string;
  city?: string | null;
  relationshipGoal?: string;
}) {
  return (
    <View style={styles.profileHeader}>
      <Text style={styles.name}>{name}</Text>
      {hasMeaningfulValue(city) ? <Text style={styles.location}>{city}</Text> : null}
      {hasMeaningfulValue(relationshipGoal) ? (
        <Text style={styles.intention}>{relationshipGoal}</Text>
      ) : null}
    </View>
  );
}

function ProfileBadge({ item }: { item: InfoItem }) {
  return (
    <View style={styles.badge}>
      {item.icon ? <Ionicons name={item.icon} size={14} color={colors.primary} /> : null}
      <Text style={styles.badgeText}>{item.value}</Text>
    </View>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ProfilePromptCard({ prompt }: { prompt: PromptItem }) {
  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptQuestion}>{prompt.question}</Text>
      <Text style={styles.promptAnswer}>{prompt.answer}</Text>
    </View>
  );
}

function ProfileInfoGrid({ items }: { items: InfoItem[] }) {
  return (
    <View style={styles.infoGrid}>
      {items.map(item => (
        <ProfileInfoCard key={item.label} item={item} />
      ))}
    </View>
  );
}

function ProfileInfoCard({ item }: { item: InfoItem }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{item.label}</Text>
      <Text style={styles.infoValue}>{item.value}</Text>
    </View>
  );
}

function ProfileInfoRow({
  label,
  value,
  isLast,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.infoRow, isLast && styles.infoRowLast]}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue}>{value}</Text>
    </View>
  );
}

function InterestChip({ label }: { label: string }) {
  return <Text style={styles.interestChip}>{label}</Text>;
}

function buildCoreBadges(profile: AppProfile | null): InfoItem[] {
  if (!profile) return [];

  return [
    profile.height ? { label: 'Height', value: `${profile.height} cm`, icon: 'resize-outline' as const } : null,
    getVisibleProfileValue(profile, 'educationLevel', profile.educationLevel ?? profile.education)
      ? { label: 'Education', value: formatProfileValue(profile.educationLevel ?? profile.education), icon: 'school-outline' as const }
      : null,
    getVisibleProfileValue(profile, 'pronouns', profile.pronouns)
      ? { label: 'Pronouns', value: formatProfileValue(profile.pronouns), icon: 'person-outline' as const }
      : null,
    getVisibleProfileValue(profile, 'mbti', profile.mbti)
      ? { label: 'MBTI', value: formatProfileValue(profile.mbti), icon: 'sparkles-outline' as const }
      : null,
    getVisibleProfileValue(profile, 'constellation', profile.constellation)
      ? { label: 'Star sign', value: formatProfileValue(profile.constellation), icon: 'star-outline' as const }
      : null,
  ].filter(Boolean).slice(0, 5) as InfoItem[];
}

function buildPrompts(profile: AppProfile | null): PromptItem[] {
  if (!profile) return [];

  return [
    { question: profile.prompt1Question, answer: profile.prompt1 },
    { question: profile.prompt2Question, answer: profile.prompt2 },
    { question: profile.prompt3Question, answer: profile.prompt3 },
  ]
    .filter((prompt): prompt is { question: string; answer: string } =>
      hasMeaningfulValue(prompt.question) && hasMeaningfulValue(prompt.answer)
    )
    .slice(0, 3)
    .map(prompt => ({
      question: prompt.question.trim(),
      answer: prompt.answer.trim(),
    }));
}

function buildMoreAbout(profile: AppProfile | null, alreadyShownLabels: string[]): InfoItem[] {
  if (!profile) return [];
  const shown = new Set(alreadyShownLabels);

  const items: Array<InfoItem | null> = [
    !shown.has('Education') && getVisibleProfileValue(profile, 'educationLevel', profile.educationLevel ?? profile.education)
      ? { label: 'Education', value: formatProfileValue(profile.educationLevel ?? profile.education) }
      : null,
    getVisibleProfileValue(profile, 'jobTitle', profile.jobTitle)
      ? { label: 'Job', value: formatProfileValue(profile.jobTitle) }
      : null,
    getVisibleProfileValue(profile, 'company', profile.company)
      ? { label: 'Workplace', value: formatProfileValue(profile.company) }
      : null,
    getVisibleProfileValue(profile, 'hometown', profile.hometown)
      ? { label: 'Hometown', value: formatProfileValue(profile.hometown) }
      : null,
    !shown.has('Height') && profile.height
      ? { label: 'Height', value: `${profile.height} cm` }
      : null,
    !shown.has('Star sign') && getVisibleProfileValue(profile, 'constellation', profile.constellation)
      ? { label: 'Star sign', value: formatProfileValue(profile.constellation) }
      : null,
    !shown.has('MBTI') && getVisibleProfileValue(profile, 'mbti', profile.mbti)
      ? { label: 'MBTI', value: formatProfileValue(profile.mbti) }
      : null,
    getVisibleProfileValue(profile, 'sexualOrientation', profile.sexualOrientation)
      ? { label: 'Orientation', value: formatProfileValue(profile.sexualOrientation) }
      : null,
  ];

  return items.filter(Boolean) as InfoItem[];
}

function buildLifestyle(profile: AppProfile | null): InfoItem[] {
  if (!profile) return [];

  const rows: Array<[string, string, unknown]> = [
    ['Smoking', 'smoking', profile.smoking],
    ['Drinking', 'drinking', profile.drinking],
    ['Exercise', 'exercise', profile.exercise],
    ['Diet', 'dietary', profile.dietary],
    ['Drug use', 'drugs', profile.drugs],
    ['Pets', 'pets', profile.pets],
    ['Sleep schedule', 'sleepHabit', profile.sleepHabit],
    ['Social style', 'socialHabit', profile.socialHabit],
  ];

  return rows
    .map(([label, field, value]) => getVisibleProfileValue(profile, field, value)
      ? { label, value: formatProfileValue(value) }
      : null
    )
    .filter(Boolean) as InfoItem[];
}

function buildRelationshipRows(profile: AppProfile | null): InfoItem[] {
  if (!profile) return [];

  const rows: Array<[string, string, unknown]> = [
    ['Looking for', 'relationshipGoal', profile.relationshipGoal],
    ['Relationship style', 'relationshipStyle', profile.relationshipStyle],
    ['Children', 'children', profile.children],
    ['Future plans', 'wantsChildren', profile.wantsChildren],
    ['Communication', 'communicationStyle', profile.communicationStyle],
    ['Ideal first date', 'idealFirstDate', profile.idealFirstDate],
  ];

  return rows
    .map(([label, field, value]) => getVisibleProfileValue(profile, field, value)
      ? { label, value: formatProfileValue(value) }
      : null
    )
    .filter(Boolean) as InfoItem[];
}

const styles = StyleSheet.create({
  photoShell: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#F4F4F7',
  },
  photoPager: {
    flex: 1,
  },
  photoPage: {
    width: '100%',
    height: '100%',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoDots: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
  },
  photoDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  photoDotActive: {
    width: 18,
    backgroundColor: '#FFFFFF',
  },
  moreButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 18,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  emptyPhoto: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#F7F7FA',
  },
  emptyPhotoIcon: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
    marginBottom: 16,
  },
  emptyPhotoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyPhotoText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  previewHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerButton: {
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
  },
  previewTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 28,
  },
  profileHeader: {
    marginBottom: 14,
  },
  name: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: 0,
  },
  location: {
    color: colors.muted,
    fontSize: 16,
    marginTop: 5,
  },
  intention: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  badge: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#F7F7FA',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#EFEFF4',
  },
  badgeText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginTop: 26,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  bodyText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  promptCard: {
    borderRadius: 20,
    backgroundColor: '#F7F7FA',
    padding: 18,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#EFEFF4',
  },
  promptQuestion: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 23,
  },
  promptAnswer: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  interestChip: {
    overflow: 'hidden',
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F3A8B3',
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
  },
  compactLine: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  infoCard: {
    width: '48.4%',
    minHeight: 86,
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#F7F7FA',
    padding: 14,
    borderWidth: 1,
    borderColor: '#EFEFF4',
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },
  infoValue: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  rowCard: {
    borderRadius: 18,
    backgroundColor: '#F7F7FA',
    borderWidth: 1,
    borderColor: '#EFEFF4',
    overflow: 'hidden',
  },
  infoRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ECECF1',
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoRowLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  infoRowValue: {
    flex: 1.2,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 26,
    paddingTop: 6,
    paddingBottom: 42,
  },
  matchedAction: {
    paddingHorizontal: 22,
    paddingBottom: 40,
  },
});
