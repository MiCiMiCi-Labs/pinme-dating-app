import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EditableField, EditableTextArea, FormSection } from '@/components/form';
import { colors } from '@/design/system';
import { type AppUser } from '@/lib/api';
import { SkeletonBox } from './ProfileSkeleton';
import { type ProfileDraft } from './types';

// ─── Option data ────────────────────────────────────────────────────────────

const relationshipGoalOptions: Array<{ label: string; value: string }> = [
  { label: 'Long-term relationship', value: 'LONG_TERM' },
  { label: 'A serious relationship, but open to short-term', value: 'SERIOUS_OPEN_TO_SHORT_TERM' },
  { label: 'Casual dating', value: 'CASUAL' },
  { label: 'Friendship', value: 'FRIENDSHIP' },
  { label: 'Still figuring it out', value: 'UNDECIDED' },
];

const pronounOptions = ['She/her', 'He/him', 'They/them', 'Self-describe', 'Prefer not to say'];
const orientationOptions = ['Straight', 'Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Queer', 'Asexual', 'Self-describe', 'Prefer not to say'];
const educationLevelOptions = ['High school', 'Trade school', 'Bachelor’s', 'Master’s', 'Doctorate', 'Prefer not to say'];
const languageOptions = ['English', 'Mandarin', 'Cantonese', 'Korean', 'Japanese', 'Spanish', 'French', 'Hindi', 'Arabic'];
const drinkingOptions = ['Never', 'Sometimes', 'Socially', 'Often', 'Prefer not to say'];
const smokingOptions = ['No', 'Sometimes', 'Yes', 'Prefer not to say'];
const exerciseOptions = ['Never', 'Sometimes', 'Weekly', 'Most days', 'Prefer not to say'];
const dietaryOptions = ['No preference', 'Vegetarian', 'Vegan', 'Halal', 'Other'];
const drugsOptions = ['No', 'Sometimes', 'Yes', 'Prefer not to say'];
const petsOptions = ['No pets', 'Dog', 'Cat', 'Other pets', 'Love pets', 'Prefer not to say'];
const sleepOptions = ['Early bird', 'Night owl', 'Flexible', 'Prefer not to say'];
const socialOptions = ['Introverted', 'Extroverted', 'Ambivert', 'Prefer not to say'];
const childrenOptions = ['No children', 'Have children', 'Prefer not to say'];
const wantsChildrenOptions = ['Want children', 'Open to children', 'Do not want children', 'Not sure', 'Prefer not to say'];
const relationshipStyleOptions = ['Monogamous', 'Non-monogamous', 'Open to discussing', 'Prefer not to say'];
const communicationOptions = ['Texting', 'Voice calls', 'Video calls', 'Meeting in person'];
const interestOptions = ['Travel', 'Cooking', 'Gaming', 'Movies', 'Music', 'Fitness', 'Hiking', 'Pets', 'Photography', 'Technology'];
const mbtiOptions = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP', 'Prefer not to say'];
const constellationOptions = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces', 'Prefer not to say'];
const promptOptions = [
  'The quickest way to my heart is...',
  'My perfect Sunday looks like...',
  'A random fact about me is...',
  'We’ll get along if...',
  'Together, we could...',
  'My biggest green flag is...',
  'The best trip I’ve ever taken was...',
  'Two truths and a lie...',
  'I’m looking for someone who...',
  'Message me if you also love...',
];

// ─── Private sub-components ──────────────────────────────────────────────────

function VisibilityToggle({
  hidden,
  onPress,
  label,
  compact = false,
}: {
  hidden: boolean;
  onPress: () => void;
  label?: string;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.visibilityToggle, compact && styles.visibilityCompact]}
      accessibilityLabel={label ?? (hidden ? 'Hidden' : 'Shown')}
    >
      <Ionicons
        name={hidden ? 'eye-off-outline' : 'eye-outline'}
        size={18}
        color={hidden ? colors.grayIcon : colors.primary}
      />
      {!compact && label ? <Text style={styles.visibilityText}>{label}</Text> : null}
    </Pressable>
  );
}

function OptionGroup({
  label,
  helper,
  options,
  value,
  values,
  hidden,
  visible,
  customValue,
  onSelect,
  onToggle,
  onToggleVisibility,
  onVisibleChange,
  onCustomValueChange,
  onAddCustom,
}: {
  label: string;
  helper?: string;
  options: string[];
  value?: string;
  values?: string[];
  hidden?: boolean;
  visible?: boolean;
  customValue?: string;
  onSelect?: (value: string) => void;
  onToggle?: (value: string) => void;
  onToggleVisibility?: () => void;
  onVisibleChange?: (visible: boolean) => void;
  onCustomValueChange?: (value: string) => void;
  onAddCustom?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isMultiSelect = Array.isArray(values);
  const selectedValues = values ?? [];
  const selectedCount = selectedValues.length;
  const displayValue = isMultiSelect
    ? selectedCount > 0 ? `${selectedCount} selected` : 'Select'
    : value || 'Select';

  return (
    <View style={styles.optionBlock}>
      <View style={styles.optionHeader}>
        <View style={styles.optionHeaderText}>
          <Text style={styles.optionLabel}>{label}</Text>
          {helper ? <Text style={styles.optionHelper}>{helper}</Text> : null}
        </View>
        {onToggleVisibility ? (
          <VisibilityToggle hidden={Boolean(hidden)} onPress={onToggleVisibility} compact />
        ) : null}
        {onVisibleChange ? (
          <VisibilityToggle
            label={visible ? 'Shown' : 'Hidden'}
            hidden={!visible}
            onPress={() => onVisibleChange(!visible)}
            compact
          />
        ) : null}
      </View>

      <Pressable style={styles.selectField} onPress={() => setExpanded(c => !c)}>
        <Text style={[styles.selectText, displayValue === 'Select' && styles.selectPlaceholder]}>
          {displayValue}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.grayIcon}
        />
      </Pressable>

      {isMultiSelect && selectedValues.length > 0 ? (
        <View style={styles.selectedChipRow}>
          {selectedValues.map(item => (
            <Pressable key={item} style={styles.selectedChip} onPress={() => onToggle?.(item)}>
              <Text style={styles.selectedChipText}>{item}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.dropdown}>
          {options.map(option => {
            const selected = values ? selectedValues.includes(option) : value === option;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  if (values) {
                    onToggle?.(option);
                  } else {
                    onSelect?.(option);
                    setExpanded(false);
                  }
                }}
                style={[styles.dropdownOption, selected && styles.dropdownOptionSelected]}
              >
                <Text style={[styles.dropdownText, selected && styles.dropdownTextSelected]}>
                  {option}
                </Text>
                {selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
          {onAddCustom ? (
            <View style={styles.customRow}>
              <TextInput
                value={customValue}
                onChangeText={onCustomValueChange}
                placeholder="Add your own"
                placeholderTextColor={colors.grayIcon}
                style={styles.customInput}
              />
              <Pressable style={styles.customAddButton} onPress={onAddCustom}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PromptEditor({
  question,
  answer,
  onQuestion,
  onAnswer,
}: {
  question: string;
  answer: string;
  onQuestion: (value: string) => void;
  onAnswer: (value: string) => void;
}) {
  return (
    <View style={styles.promptBlock}>
      <OptionGroup
        label="Choose a prompt"
        options={promptOptions}
        value={question}
        onSelect={onQuestion}
      />
      <EditableTextArea
        label="Your answer"
        value={answer}
        onChangeText={onAnswer}
        placeholder="Write your answer..."
      />
    </View>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function SectionsSkeleton() {
  return (
    <View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.skeletonSection}>
          <SkeletonBox style={{ height: 20, width: '38%', marginBottom: 14 }} />
          <SkeletonBox style={{ height: 54, borderRadius: 14, marginBottom: 10 }} />
          <SkeletonBox style={{ height: 54, borderRadius: 14 }} />
        </View>
      ))}
    </View>
  );
}

// ─── Public component ────────────────────────────────────────────────────────

export type ProfileSectionsHandlers = {
  set: (key: keyof ProfileDraft) => (value: string) => void;
  setBoolean: (key: 'companyVisible' | 'sexualOrientationVisible') => (value: boolean) => void;
  toggleHiddenField: (field: string) => void;
  setSingleOption: (key: keyof ProfileDraft, value: string) => void;
  toggleListItem: (key: 'languages' | 'interests', value: string) => void;
  addCustomInterest: () => void;
  setCustomInterest: (value: string) => void;
};

type Props = {
  user: AppUser | null;
  draft: ProfileDraft;
  loading: boolean;
  customInterest: string;
  birthdayDisplay: string;
} & ProfileSectionsHandlers;

export function ProfileSections({
  user,
  draft,
  loading,
  customInterest,
  birthdayDisplay,
  set,
  setBoolean,
  toggleHiddenField,
  setSingleOption,
  toggleListItem,
  addCustomInterest,
  setCustomInterest,
}: Props) {
  if (loading) return <SectionsSkeleton />;

  return (
    <>
      <FormSection title="Account">
        <EditableField label="Name" value={user?.name ?? ''} />
        <EditableField label="Email" value={user?.email ?? ''} />
        <EditableField label="Gender" value={user?.gender ?? ''} />
        <EditableField label="Birthday" value={birthdayDisplay} />
      </FormSection>

      <FormSection title="Basic profile">
        <EditableField label="City" value={draft.city} onChangeText={set('city')} />
        <EditableField label="Height (cm)" value={draft.height} onChangeText={set('height')} />
        <EditableTextArea
          value={draft.bio}
          onChangeText={set('bio')}
          placeholder="Tell people a little about you..."
        />
      </FormSection>

      <FormSection title="Show who you are" helper="These help people understand you. Company is hidden by default.">
        <OptionGroup
          label="What are your pronouns?"
          options={pronounOptions}
          value={draft.pronouns}
          onSelect={v => setSingleOption('pronouns', v)}
          hidden={draft.hiddenFields.includes('pronouns')}
          onToggleVisibility={() => toggleHiddenField('pronouns')}
        />
        <OptionGroup
          label="How do you describe your sexual orientation?"
          helper="Sensitive and optional. Hidden unless you choose to show it."
          options={orientationOptions}
          value={draft.sexualOrientation}
          onSelect={v => setSingleOption('sexualOrientation', v)}
          visible={draft.sexualOrientationVisible}
          onVisibleChange={setBoolean('sexualOrientationVisible')}
        />
        <OptionGroup
          label="What is your education level?"
          options={educationLevelOptions}
          value={draft.educationLevel}
          onSelect={v => setSingleOption('educationLevel', v)}
          hidden={draft.hiddenFields.includes('educationLevel')}
          onToggleVisibility={() => toggleHiddenField('educationLevel')}
        />
        <EditableField label="Where did you study?" value={draft.education} onChangeText={set('education')} />
        <EditableField
          label="What do you do?"
          value={draft.jobTitle}
          onChangeText={set('jobTitle')}
          rightAccessory={
            <VisibilityToggle
              hidden={draft.hiddenFields.includes('jobTitle')}
              onPress={() => toggleHiddenField('jobTitle')}
              compact
            />
          }
        />
        <EditableField
          label="Where do you work?"
          value={draft.company}
          onChangeText={set('company')}
          rightAccessory={
            <VisibilityToggle
              label={draft.companyVisible ? 'Company visible' : 'Company hidden by default'}
              hidden={!draft.companyVisible}
              onPress={() => setBoolean('companyVisible')(!draft.companyVisible)}
              compact
            />
          }
        />
        <OptionGroup
          label="Which languages do you speak?"
          options={languageOptions}
          values={draft.languages}
          onToggle={v => toggleListItem('languages', v)}
          hidden={draft.hiddenFields.includes('languages')}
          onToggleVisibility={() => toggleHiddenField('languages')}
        />
        <EditableField
          label="Where are you originally from?"
          value={draft.hometown}
          onChangeText={set('hometown')}
          rightAccessory={
            <VisibilityToggle
              hidden={draft.hiddenFields.includes('hometown')}
              onPress={() => toggleHiddenField('hometown')}
              compact
            />
          }
        />
        <OptionGroup
          label="Star sign"
          options={constellationOptions}
          value={draft.constellation}
          onSelect={v => setSingleOption('constellation', v)}
          hidden={draft.hiddenFields.includes('constellation')}
          onToggleVisibility={() => toggleHiddenField('constellation')}
        />
        <OptionGroup
          label="MBTI"
          options={mbtiOptions}
          value={draft.mbti}
          onSelect={v => setSingleOption('mbti', v)}
          hidden={draft.hiddenFields.includes('mbti')}
          onToggleVisibility={() => toggleHiddenField('mbti')}
        />
      </FormSection>

      <FormSection title="Lifestyle">
        <OptionGroup label="Do you smoke?" options={smokingOptions} value={draft.smoking} onSelect={v => setSingleOption('smoking', v)} hidden={draft.hiddenFields.includes('smoking')} onToggleVisibility={() => toggleHiddenField('smoking')} />
        <OptionGroup label="Do you drink?" options={drinkingOptions} value={draft.drinking} onSelect={v => setSingleOption('drinking', v)} hidden={draft.hiddenFields.includes('drinking')} onToggleVisibility={() => toggleHiddenField('drinking')} />
        <OptionGroup label="How often do you exercise?" options={exerciseOptions} value={draft.exercise} onSelect={v => setSingleOption('exercise', v)} hidden={draft.hiddenFields.includes('exercise')} onToggleVisibility={() => toggleHiddenField('exercise')} />
        <OptionGroup label="What are your dietary preferences?" options={dietaryOptions} value={draft.dietary} onSelect={v => setSingleOption('dietary', v)} hidden={draft.hiddenFields.includes('dietary')} onToggleVisibility={() => toggleHiddenField('dietary')} />
        <OptionGroup label="Do you use drugs?" options={drugsOptions} value={draft.drugs} onSelect={v => setSingleOption('drugs', v)} hidden={draft.hiddenFields.includes('drugs')} onToggleVisibility={() => toggleHiddenField('drugs')} />
        <OptionGroup label="Do you have any pets?" options={petsOptions} value={draft.pets} onSelect={v => setSingleOption('pets', v)} hidden={draft.hiddenFields.includes('pets')} onToggleVisibility={() => toggleHiddenField('pets')} />
        <OptionGroup label="Are you an early bird or a night owl?" options={sleepOptions} value={draft.sleepHabit} onSelect={v => setSingleOption('sleepHabit', v)} hidden={draft.hiddenFields.includes('sleepHabit')} onToggleVisibility={() => toggleHiddenField('sleepHabit')} />
        <OptionGroup label="Are you more introverted or extroverted?" options={socialOptions} value={draft.socialHabit} onSelect={v => setSingleOption('socialHabit', v)} hidden={draft.hiddenFields.includes('socialHabit')} onToggleVisibility={() => toggleHiddenField('socialHabit')} />
      </FormSection>

      <FormSection title="Relationship and future plans" helper="Relationship style is always shown when filled.">
        <OptionGroup
          label="What are you looking for?"
          options={relationshipGoalOptions.map(o => o.label)}
          value={relationshipGoalOptions.find(o => o.value === draft.relationshipGoal)?.label ?? ''}
          onSelect={label => setSingleOption('relationshipGoal', relationshipGoalOptions.find(o => o.label === label)?.value ?? '')}
        />
        <OptionGroup label="Do you have children?" options={childrenOptions} value={draft.children} onSelect={v => setSingleOption('children', v)} hidden={draft.hiddenFields.includes('children')} onToggleVisibility={() => toggleHiddenField('children')} />
        <OptionGroup label="Do you want children in the future?" options={wantsChildrenOptions} value={draft.wantsChildren} onSelect={v => setSingleOption('wantsChildren', v)} hidden={draft.hiddenFields.includes('wantsChildren')} onToggleVisibility={() => toggleHiddenField('wantsChildren')} />
        <OptionGroup label="What kind of relationship works for you?" options={relationshipStyleOptions} value={draft.relationshipStyle} onSelect={v => setSingleOption('relationshipStyle', v)} />
        <OptionGroup label="What's your preferred communication style?" options={communicationOptions} value={draft.communicationStyle} onSelect={v => setSingleOption('communicationStyle', v)} hidden={draft.hiddenFields.includes('communicationStyle')} onToggleVisibility={() => toggleHiddenField('communicationStyle')} />
        <EditableTextArea
          label="What's your ideal first date?"
          value={draft.idealFirstDate}
          onChangeText={set('idealFirstDate')}
          placeholder="Write your answer..."
          rightAccessory={
            <VisibilityToggle
              hidden={draft.hiddenFields.includes('idealFirstDate')}
              onPress={() => toggleHiddenField('idealFirstDate')}
              compact
            />
          }
        />
      </FormSection>

      <FormSection title="Interests">
        <OptionGroup
          label="Choose your interests."
          helper={`${draft.interests.length}/8 selected. Choose 3–8.`}
          options={interestOptions}
          values={draft.interests}
          onToggle={v => toggleListItem('interests', v)}
          hidden={draft.hiddenFields.includes('interests')}
          onToggleVisibility={() => toggleHiddenField('interests')}
          customValue={customInterest}
          onCustomValueChange={setCustomInterest}
          onAddCustom={addCustomInterest}
        />
        <EditableTextArea
          label="What does your ideal weekend look like?"
          value={draft.weekend}
          onChangeText={set('weekend')}
          placeholder="Write your answer..."
          rightAccessory={
            <VisibilityToggle
              hidden={draft.hiddenFields.includes('weekend')}
              onPress={() => toggleHiddenField('weekend')}
              compact
            />
          }
        />
        <EditableTextArea
          label="What music, movies or food are you into?"
          value={draft.favorites}
          onChangeText={set('favorites')}
          placeholder="Write your answer..."
          rightAccessory={
            <VisibilityToggle
              hidden={draft.hiddenFields.includes('favorites')}
              onPress={() => toggleHiddenField('favorites')}
              compact
            />
          }
        />
      </FormSection>

      <FormSection title="Prompts" helper="Answer 2–3 prompts to give people better conversation starters.">
        <PromptEditor
          question={draft.prompt1Question}
          answer={draft.prompt1}
          onQuestion={v => setSingleOption('prompt1Question', v)}
          onAnswer={set('prompt1')}
        />
        <PromptEditor
          question={draft.prompt2Question}
          answer={draft.prompt2}
          onQuestion={v => setSingleOption('prompt2Question', v)}
          onAnswer={set('prompt2')}
        />
        <PromptEditor
          question={draft.prompt3Question}
          answer={draft.prompt3}
          onQuestion={v => setSingleOption('prompt3Question', v)}
          onAnswer={set('prompt3')}
        />
      </FormSection>
    </>
  );
}

const styles = StyleSheet.create({
  skeletonSection: { marginTop: 28 },
  optionBlock: { marginTop: 14 },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  optionHeaderText: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: 14, fontWeight: '900', lineHeight: 19 },
  optionHelper: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  selectField: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800', paddingRight: 12 },
  selectPlaceholder: { color: colors.grayIcon },
  selectedChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  selectedChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.soft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
  },
  selectedChipText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  dropdown: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    marginTop: 8,
  },
  dropdownOption: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  dropdownOptionSelected: { backgroundColor: '#FFF7F8' },
  dropdownText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' },
  dropdownTextSelected: { color: colors.primary },
  customRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  customInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 12,
  },
  customAddButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityToggle: {
    alignSelf: 'flex-start',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  visibilityCompact: { marginTop: 0, marginBottom: 0, width: 34, height: 34, paddingHorizontal: 0 },
  visibilityText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  promptBlock: { marginTop: 12 },
});
