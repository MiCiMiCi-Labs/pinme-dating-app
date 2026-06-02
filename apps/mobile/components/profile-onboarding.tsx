import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  IconButton,
  InterestPill,
  photos,
  PrimaryButton,
  ProfileThumb,
} from '@/design/system';

export const profileOnboardingSteps = [
  'details',
  'gender',
  'passions',
  'friends',
  'notifications',
] as const;

export type ProfileOnboardingStep = (typeof profileOnboardingSteps)[number];

const interests = [
  ['Photography', 'camera-outline'],
  ['Shopping', 'shopping-outline'],
  ['Karaoke', 'microphone-outline'],
  ['Yoga', 'meditation'],
  ['Cooking', 'pot-steam-outline'],
  ['Tennis', 'tennis'],
  ['Run', 'run'],
  ['Swimming', 'waves'],
  ['Art', 'palette-outline'],
  ['Traveling', 'image-filter-hdr'],
  ['Extreme', 'diamond-stone'],
  ['Music', 'music-note-outline'],
] as const;

export function ProfileOnboardingNav({
  canGoBack,
  onBack,
  onSkip,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.navRow}>
      {canGoBack ? <IconButton icon="chevron-back" onPress={onBack} /> : <View />}
      <Pressable onPress={onSkip}>
        <Text style={styles.skip}>Skip</Text>
      </Pressable>
    </View>
  );
}

export function ProfileOnboardingStepView({
  step,
  onBirthdayPress,
}: {
  step: ProfileOnboardingStep;
  onBirthdayPress: () => void;
}) {
  if (step === 'details') return <DetailsStep onBirthdayPress={onBirthdayPress} />;
  if (step === 'gender') return <GenderStep />;
  if (step === 'passions') return <PassionsStep />;
  if (step === 'friends') {
    return (
      <PermissionStep
        type="friends"
        title="Search friend’s"
        copy="You can find friends from your contact lists to connected"
      />
    );
  }
  return (
    <PermissionStep
      type="notifications"
      title="Enable notification’s"
      copy="Get push-notification when you get the match or receive a message."
    />
  );
}

export function BirthdaySheet({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.overlay}>
      <Pressable style={styles.dim} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.sheetLabel}>Birthday</Text>
        <View style={styles.yearRow}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
          <View style={styles.yearBlock}>
            <Text style={styles.year}>1995</Text>
            <Text style={styles.month}>July</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </View>
        <View style={styles.calendarGrid}>
          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
            <View key={day} style={[styles.day, day === 11 && styles.daySelected]}>
              <Text style={[styles.dayText, day === 11 && styles.dayTextSelected]}>{day}</Text>
            </View>
          ))}
        </View>
        <PrimaryButton onPress={onClose} style={styles.sheetButton}>
          Save
        </PrimaryButton>
      </View>
    </View>
  );
}

function DetailsStep({ onBirthdayPress }: { onBirthdayPress: () => void }) {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Profile details</Text>
      <View style={styles.avatarWrap}>
        <ProfileThumb uri={photos.man} size={100} style={styles.avatar} />
        <Pressable style={styles.camera}>
          <Ionicons name="camera" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
      <ProfileInput label="First name" value="David" />
      <ProfileInput label="Last name" value="Peterson" />
      <Pressable style={styles.birthdayButton} onPress={onBirthdayPress}>
        <Ionicons name="calendar-outline" size={22} color={colors.primary} />
        <Text style={styles.birthdayText}>Choose birthday date</Text>
      </Pressable>
    </View>
  );
}

function GenderStep() {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>I am a</Text>
      <View style={styles.genderList}>
        {['Woman', 'Man', 'Choose another'].map((item, index) => (
          <Pressable key={item} style={[styles.genderOption, index === 1 && styles.genderSelected]}>
            <Text style={[styles.genderText, index === 1 && styles.genderTextSelected]}>{item}</Text>
            <Ionicons
              name={index === 2 ? 'chevron-forward' : 'checkmark'}
              size={20}
              color={index === 1 ? '#FFFFFF' : colors.grayIcon}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PassionsStep() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>Your interests</Text>
      <Text style={styles.copy}>
        Select a few of your interests and let everyone know what you’re passionate about.
      </Text>
      <View style={styles.interestGrid}>
        {interests.map(([label, icon], index) => (
          <InterestPill key={label} label={label} icon={icon} selected={[1, 6, 9].includes(index)} />
        ))}
      </View>
    </ScrollView>
  );
}

function PermissionStep({
  type,
  title,
  copy,
}: {
  type: 'friends' | 'notifications';
  title: string;
  copy: string;
}) {
  return (
    <View style={[styles.content, styles.centered]}>
      {type === 'friends' ? <FriendsArt /> : <NotificationArt />}
      <Text style={styles.centerTitle}>{title}</Text>
      <Text style={styles.centerCopy}>{copy}</Text>
    </View>
  );
}

function FriendsArt() {
  return (
    <View style={styles.friendArt}>
      <View style={[styles.orb, styles.orbOne]} />
      <View style={[styles.orb, styles.orbTwo]} />
      <View style={[styles.orb, styles.orbThree]} />
    </View>
  );
}

function NotificationArt() {
  return (
    <View style={styles.messageArt}>
      <View style={styles.messageBack} />
      <View style={styles.messageFront}>
        <View style={styles.messageLineLong} />
        <View style={styles.messageLineShort} />
      </View>
    </View>
  );
}

function ProfileInput({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} style={styles.textInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 12,
  },
  skip: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  content: { flex: 1, paddingHorizontal: 28 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 28, paddingBottom: 20 },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 22,
    marginBottom: 28,
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: -28,
    marginBottom: 34,
  },
  avatarWrap: { alignItems: 'center', marginBottom: 34 },
  avatar: { borderRadius: 28 },
  camera: {
    position: 'absolute',
    right: '34%',
    bottom: -10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    height: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  label: {
    position: 'absolute',
    top: -10,
    left: 22,
    backgroundColor: colors.bg,
    color: '#B0B0B8',
    fontSize: 12,
    paddingHorizontal: 8,
  },
  textInput: { color: colors.text, fontSize: 15 },
  birthdayButton: {
    height: 58,
    borderRadius: 14,
    backgroundColor: colors.soft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
  },
  birthdayText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  genderList: { gap: 12, marginTop: 16 },
  genderOption: {
    height: 60,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  genderSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  genderText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  genderTextSelected: { color: '#FFFFFF' },
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  friendArt: { width: 190, height: 190, marginBottom: 50 },
  orb: {
    position: 'absolute',
    backgroundColor: '#A84FB5',
    shadowColor: '#A84FB5',
    shadowOpacity: 0.32,
    shadowRadius: 18,
  },
  orbOne: { width: 104, height: 104, borderRadius: 52, right: 18, top: 0 },
  orbTwo: {
    width: 148,
    height: 62,
    borderRadius: 34,
    bottom: 20,
    right: 0,
    transform: [{ rotate: '9deg' }],
  },
  orbThree: {
    width: 142,
    height: 100,
    borderRadius: 70,
    left: 0,
    top: 52,
    backgroundColor: '#FAF0FA',
  },
  messageArt: { width: 210, height: 180, marginBottom: 52 },
  messageBack: {
    position: 'absolute',
    width: 164,
    height: 126,
    borderRadius: 22,
    right: 0,
    top: 0,
    backgroundColor: '#F5A44D',
  },
  messageFront: {
    position: 'absolute',
    width: 164,
    height: 116,
    borderRadius: 22,
    left: 0,
    top: 40,
    backgroundColor: '#FFE8D7',
    shadowColor: '#E87E34',
    shadowOpacity: 0.28,
    shadowRadius: 20,
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 18,
  },
  messageLineLong: { height: 22, borderRadius: 12, backgroundColor: '#F9BF83' },
  messageLineShort: { width: 76, height: 22, borderRadius: 12, backgroundColor: '#FAD7B7' },
  centerTitle: { color: colors.text, fontSize: 26, fontWeight: '900', marginBottom: 14 },
  centerCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 280,
  },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    minHeight: 470,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
    paddingTop: 44,
  },
  sheetLabel: { color: colors.text, fontSize: 14, textAlign: 'center' },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  yearBlock: { alignItems: 'center' },
  year: { color: colors.primary, fontSize: 32, fontWeight: '900' },
  month: { color: colors.primary, fontSize: 14 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 28 },
  day: {
    width: '14.285%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    marginBottom: 8,
  },
  daySelected: { backgroundColor: colors.primary },
  dayText: { color: colors.text, fontSize: 13 },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  sheetButton: { marginTop: 22 },
});
