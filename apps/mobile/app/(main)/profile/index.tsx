import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EditableField, EditableTextArea, FormSection, PhotoUploadGrid } from '@/components/form';
import { colors, IconButton, PrimaryButton } from '@/design/system';
import {
  getCurrentAppUser,
  getMyPhotos,
  updateMyProfileData,
  type AppUser,
  type Photo,
  type RelationshipGoal,
} from '@/lib/api';
import {
  getDetailedProfileCompletion,
  matchingProfileCompletionThreshold,
} from '@/lib/profileCompleteness';
import { supabase } from '@/lib/supabase';

type ProfileDraft = {
  city: string;
  bio: string;
  height: string;
  pronouns: string;
  sexualOrientation: string;
  sexualOrientationVisible: boolean;
  education: string;
  educationLevel: string;
  jobTitle: string;
  company: string;
  companyVisible: boolean;
  languages: string[];
  hometown: string;
  relationshipGoal: RelationshipGoal | '';
  drinking: string;
  smoking: string;
  exercise: string;
  dietary: string;
  drugs: string;
  pets: string;
  sleepHabit: string;
  socialHabit: string;
  children: string;
  wantsChildren: string;
  relationshipStyle: string;
  communicationStyle: string;
  idealFirstDate: string;
  interests: string[];
  weekend: string;
  favorites: string;
  mbti: string;
  constellation: string;
  prompt1Question: string;
  prompt1: string;
  prompt2Question: string;
  prompt2: string;
  prompt3Question: string;
  prompt3: string;
  hiddenFields: string[];
};

const emptyDraft: ProfileDraft = {
  city: '',
  bio: '',
  height: '',
  pronouns: '',
  sexualOrientation: '',
  sexualOrientationVisible: false,
  education: '',
  educationLevel: '',
  jobTitle: '',
  company: '',
  companyVisible: false,
  languages: [],
  hometown: '',
  relationshipGoal: '',
  drinking: '',
  smoking: '',
  exercise: '',
  dietary: '',
  drugs: '',
  pets: '',
  sleepHabit: '',
  socialHabit: '',
  children: '',
  wantsChildren: '',
  relationshipStyle: '',
  communicationStyle: '',
  idealFirstDate: '',
  interests: [],
  weekend: '',
  favorites: '',
  mbti: '',
  constellation: '',
  prompt1Question: '',
  prompt1: '',
  prompt2Question: '',
  prompt2: '',
  prompt3Question: '',
  prompt3: '',
  hiddenFields: ['company'],
};

const relationshipGoalOptions: Array<{ label: string; value: RelationshipGoal }> = [
  { label: 'Long-term relationship', value: 'LONG_TERM' },
  {
    label: 'A serious relationship, but open to short-term',
    value: 'SERIOUS_OPEN_TO_SHORT_TERM',
  },
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

function normalizeRelationshipGoal(goal: RelationshipGoal | null | undefined): RelationshipGoal | '' {
  if (goal === 'SERIOUS') return 'SERIOUS_OPEN_TO_SHORT_TERM';
  return goal ?? '';
}

function draftFromUser(user: AppUser): ProfileDraft {
  const profile = user.profile;

  return {
    city: user.city ?? '',
    bio: user.bio ?? '',
    height: profile?.height != null ? String(profile.height) : '',
    pronouns: profile?.pronouns ?? '',
    sexualOrientation: profile?.sexualOrientation ?? '',
    sexualOrientationVisible: Boolean(profile?.sexualOrientationVisible),
    education: profile?.education ?? '',
    educationLevel: profile?.educationLevel ?? '',
    jobTitle: profile?.jobTitle ?? '',
    company: profile?.company ?? '',
    companyVisible: Boolean(profile?.companyVisible),
    languages: profile?.languages ?? [],
    hometown: profile?.hometown ?? '',
    relationshipGoal: normalizeRelationshipGoal(profile?.relationshipGoal),
    drinking: profile?.drinking ?? '',
    smoking: profile?.smoking ?? '',
    exercise: profile?.exercise ?? '',
    dietary: profile?.dietary ?? '',
    drugs: profile?.drugs ?? '',
    pets: profile?.pets ?? '',
    sleepHabit: profile?.sleepHabit ?? '',
    socialHabit: profile?.socialHabit ?? '',
    children: profile?.children ?? '',
    wantsChildren: profile?.wantsChildren ?? '',
    relationshipStyle: profile?.relationshipStyle ?? '',
    communicationStyle: profile?.communicationStyle ?? '',
    idealFirstDate: profile?.idealFirstDate ?? '',
    interests: profile?.interests ?? [],
    weekend: profile?.weekend ?? '',
    favorites: profile?.favorites ?? '',
    mbti: profile?.mbti ?? '',
    constellation: profile?.constellation ?? '',
    prompt1Question: profile?.prompt1Question ?? '',
    prompt1: profile?.prompt1 ?? '',
    prompt2Question: profile?.prompt2Question ?? '',
    prompt2: profile?.prompt2 ?? '',
    prompt3Question: profile?.prompt3Question ?? '',
    prompt3: profile?.prompt3 ?? '',
    hiddenFields: profile?.hiddenFields?.length ? profile.hiddenFields : ['company'],
  };
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function MyProfileScreen() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customInterest, setCustomInterest] = useState('');
  const hasLoadedRef = useRef(false);

  const photoSlots = useMemo(() => {
    const sorted = [
      ...photos.filter(p => p.isPrimary),
      ...photos.filter(p => !p.isPrimary),
    ];
    const slots: Array<string | null> = Array(6).fill(null);
    sorted.forEach((p, i) => { if (i < 6) slots[i] = p.url; });
    return slots;
  }, [photos]);

  const primaryVerified = useMemo(
    () => photos.find(p => p.isPrimary)?.isVerified ?? false,
    [photos]
  );

  const completion = useMemo(
    () => getDetailedProfileCompletion(user, photos),
    [user, photos]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadProfile() {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) return;

        try {
          if (!hasLoadedRef.current) setLoading(true);
          const [{ user: appUser }, loadedPhotos] = await Promise.all([
            getCurrentAppUser(session.access_token),
            getMyPhotos(session.access_token),
          ]);

          if (!cancelled) {
            setUser(appUser);
            setDraft(draftFromUser(appUser));
            setPhotos(loadedPhotos);
            hasLoadedRef.current = true;
          }
        } catch (error) {
          if (!cancelled) {
            Alert.alert(
              'Profile error',
              error instanceof Error ? error.message : 'Failed to load profile.'
            );
          }
        } finally {
          if (!cancelled) {
            hasLoadedRef.current = true;
            setLoading(false);
          }
        }
      }

      loadProfile();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const set = (key: keyof ProfileDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const setBoolean = (key: 'companyVisible' | 'sexualOrientationVisible') => (value: boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleHiddenField = (field: string) => {
    if (field === 'relationshipStyle') return;

    setDraft((current) => {
      const hidden = new Set(current.hiddenFields);
      if (hidden.has(field)) {
        hidden.delete(field);
      } else {
        hidden.add(field);
      }
      return { ...current, hiddenFields: Array.from(hidden) };
    });
  };

  const setSingleOption = (key: keyof ProfileDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleListItem = (key: 'languages' | 'interests', value: string) => {
    setDraft((current) => {
      const list = current[key];
      const exists = list.includes(value);

      if (!exists && key === 'interests' && list.length >= 8) {
        return current;
      }

      return {
        ...current,
        [key]: exists ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  const addCustomInterest = () => {
    const value = customInterest.trim();
    if (!value) return;

    setDraft((current) => {
      if (current.interests.includes(value) || current.interests.length >= 8) {
        return current;
      }

      return { ...current, interests: [...current.interests, value] };
    });
    setCustomInterest('');
  };

  const validate = () => {
    if (draft.height) {
      const height = Number(draft.height);

      if (!Number.isInteger(height) || height < 120 || height > 230) {
        return 'Height must be between 120 and 230 cm.';
      }
    }

    if (draft.mbti && draft.mbti.length > 4) {
      return 'MBTI should be 4 characters or fewer.';
    }

    if (draft.interests.length > 0 && draft.interests.length < 3) {
      return 'Choose 3–8 interests, or leave interests empty for now.';
    }

    return null;
  };

  const saveChanges = async () => {
    if (saving) return;

    const validationError = validate();

    if (validationError) {
      Alert.alert('Invalid input', validationError);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.replace('/(auth)/login');
      return;
    }

    setSaving(true);

    try {
      const hiddenFields = draft.hiddenFields.filter((field) => field !== 'relationshipStyle');
      const result = await updateMyProfileData(session.access_token, {
        city: nullable(draft.city),
        bio: nullable(draft.bio),
        height: draft.height ? Number(draft.height) : null,
        pronouns: nullable(draft.pronouns),
        sexualOrientation: nullable(draft.sexualOrientation),
        sexualOrientationVisible: Boolean(draft.sexualOrientation && draft.sexualOrientationVisible),
        education: nullable(draft.education),
        educationLevel: nullable(draft.educationLevel),
        jobTitle: nullable(draft.jobTitle),
        company: nullable(draft.company),
        companyVisible: Boolean(draft.company && draft.companyVisible),
        languages: draft.languages,
        hometown: nullable(draft.hometown),
        relationshipGoal: draft.relationshipGoal || null,
        drinking: nullable(draft.drinking),
        smoking: nullable(draft.smoking),
        exercise: nullable(draft.exercise),
        dietary: nullable(draft.dietary),
        drugs: nullable(draft.drugs),
        pets: nullable(draft.pets),
        sleepHabit: nullable(draft.sleepHabit),
        socialHabit: nullable(draft.socialHabit),
        children: nullable(draft.children),
        wantsChildren: nullable(draft.wantsChildren),
        relationshipStyle: nullable(draft.relationshipStyle),
        communicationStyle: nullable(draft.communicationStyle),
        idealFirstDate: nullable(draft.idealFirstDate),
        interests: draft.interests,
        weekend: nullable(draft.weekend),
        favorites: nullable(draft.favorites),
        mbti: nullable(draft.mbti),
        constellation: nullable(draft.constellation),
        prompt1Question: nullable(draft.prompt1Question),
        prompt1: nullable(draft.prompt1),
        prompt2Question: nullable(draft.prompt2Question),
        prompt2: nullable(draft.prompt2),
        prompt3Question: nullable(draft.prompt3Question),
        prompt3: nullable(draft.prompt3),
        hiddenFields,
      });

      const nextUser: AppUser = {
        ...result.user,
        profile: result.profile,
      };

      setUser(nextUser);
      setDraft(draftFromUser(nextUser));
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  const birthdayDisplay = user?.birthday ? new Date(user.birthday).toLocaleDateString() : '';
  const canStartMatching = completion.percent >= matchingProfileCompletionThreshold;

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My profile</Text>
            <Text style={styles.subtitle}>
              {loading ? 'Loading profile...' : 'Complete more details to unlock matching.'}
            </Text>
          </View>
          <IconButton icon="settings-outline" />
        </View>

        <View style={styles.completionCard}>
          <View style={styles.completionTop}>
            <Text style={styles.completionTitle}>Profile strength</Text>
            <Text style={styles.completionPercent}>{completion.percent}%</Text>
          </View>
          <View style={styles.completionTrack}>
            <View style={[styles.completionFill, { width: `${completion.percent}%` }]} />
          </View>
          <Text style={styles.completionCopy}>
            {canStartMatching
              ? 'You can enter the matching page now.'
              : `Reach ${matchingProfileCompletionThreshold}% to start matching.`}
          </Text>
        </View>

        <PhotoUploadGrid photos={photoSlots} primaryVerified={primaryVerified} />

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
            onSelect={(value) => setSingleOption('pronouns', value)}
            hidden={draft.hiddenFields.includes('pronouns')}
            onToggleVisibility={() => toggleHiddenField('pronouns')}
          />
          <OptionGroup
            label="How do you describe your sexual orientation?"
            helper="Sensitive and optional. Hidden unless you choose to show it."
            options={orientationOptions}
            value={draft.sexualOrientation}
            onSelect={(value) => setSingleOption('sexualOrientation', value)}
            visible={draft.sexualOrientationVisible}
            onVisibleChange={setBoolean('sexualOrientationVisible')}
          />
          <OptionGroup
            label="What is your education level?"
            options={educationLevelOptions}
            value={draft.educationLevel}
            onSelect={(value) => setSingleOption('educationLevel', value)}
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
            onToggle={(value) => toggleListItem('languages', value)}
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
            onSelect={(value) => setSingleOption('constellation', value)}
            hidden={draft.hiddenFields.includes('constellation')}
            onToggleVisibility={() => toggleHiddenField('constellation')}
          />
          <OptionGroup
            label="MBTI"
            options={mbtiOptions}
            value={draft.mbti}
            onSelect={(value) => setSingleOption('mbti', value)}
            hidden={draft.hiddenFields.includes('mbti')}
            onToggleVisibility={() => toggleHiddenField('mbti')}
          />
        </FormSection>

        <FormSection title="Lifestyle">
          <OptionGroup label="Do you smoke?" options={smokingOptions} value={draft.smoking} onSelect={(value) => setSingleOption('smoking', value)} hidden={draft.hiddenFields.includes('smoking')} onToggleVisibility={() => toggleHiddenField('smoking')} />
          <OptionGroup label="Do you drink?" options={drinkingOptions} value={draft.drinking} onSelect={(value) => setSingleOption('drinking', value)} hidden={draft.hiddenFields.includes('drinking')} onToggleVisibility={() => toggleHiddenField('drinking')} />
          <OptionGroup label="How often do you exercise?" options={exerciseOptions} value={draft.exercise} onSelect={(value) => setSingleOption('exercise', value)} hidden={draft.hiddenFields.includes('exercise')} onToggleVisibility={() => toggleHiddenField('exercise')} />
          <OptionGroup label="What are your dietary preferences?" options={dietaryOptions} value={draft.dietary} onSelect={(value) => setSingleOption('dietary', value)} hidden={draft.hiddenFields.includes('dietary')} onToggleVisibility={() => toggleHiddenField('dietary')} />
          <OptionGroup label="Do you use drugs?" options={drugsOptions} value={draft.drugs} onSelect={(value) => setSingleOption('drugs', value)} hidden={draft.hiddenFields.includes('drugs')} onToggleVisibility={() => toggleHiddenField('drugs')} />
          <OptionGroup label="Do you have any pets?" options={petsOptions} value={draft.pets} onSelect={(value) => setSingleOption('pets', value)} hidden={draft.hiddenFields.includes('pets')} onToggleVisibility={() => toggleHiddenField('pets')} />
          <OptionGroup label="Are you an early bird or a night owl?" options={sleepOptions} value={draft.sleepHabit} onSelect={(value) => setSingleOption('sleepHabit', value)} hidden={draft.hiddenFields.includes('sleepHabit')} onToggleVisibility={() => toggleHiddenField('sleepHabit')} />
          <OptionGroup label="Are you more introverted or extroverted?" options={socialOptions} value={draft.socialHabit} onSelect={(value) => setSingleOption('socialHabit', value)} hidden={draft.hiddenFields.includes('socialHabit')} onToggleVisibility={() => toggleHiddenField('socialHabit')} />
        </FormSection>

        <FormSection title="Relationship and future plans" helper="Relationship style is always shown when filled.">
          <OptionGroup label="What are you looking for?" options={relationshipGoalOptions.map((item) => item.label)} value={relationshipGoalOptions.find((item) => item.value === draft.relationshipGoal)?.label ?? ''} onSelect={(label) => setSingleOption('relationshipGoal', relationshipGoalOptions.find((item) => item.label === label)?.value ?? '')} />
          <OptionGroup label="Do you have children?" options={childrenOptions} value={draft.children} onSelect={(value) => setSingleOption('children', value)} hidden={draft.hiddenFields.includes('children')} onToggleVisibility={() => toggleHiddenField('children')} />
          <OptionGroup label="Do you want children in the future?" options={wantsChildrenOptions} value={draft.wantsChildren} onSelect={(value) => setSingleOption('wantsChildren', value)} hidden={draft.hiddenFields.includes('wantsChildren')} onToggleVisibility={() => toggleHiddenField('wantsChildren')} />
          <OptionGroup label="What kind of relationship works for you?" options={relationshipStyleOptions} value={draft.relationshipStyle} onSelect={(value) => setSingleOption('relationshipStyle', value)} />
          <OptionGroup label="What’s your preferred communication style?" options={communicationOptions} value={draft.communicationStyle} onSelect={(value) => setSingleOption('communicationStyle', value)} hidden={draft.hiddenFields.includes('communicationStyle')} onToggleVisibility={() => toggleHiddenField('communicationStyle')} />
          <EditableTextArea
            label="What’s your ideal first date?"
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
            onToggle={(value) => toggleListItem('interests', value)}
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
            onQuestion={(value) => setSingleOption('prompt1Question', value)}
            onAnswer={set('prompt1')}
          />
          <PromptEditor
            question={draft.prompt2Question}
            answer={draft.prompt2}
            onQuestion={(value) => setSingleOption('prompt2Question', value)}
            onAnswer={set('prompt2')}
          />
          <PromptEditor
            question={draft.prompt3Question}
            answer={draft.prompt3}
            onQuestion={(value) => setSingleOption('prompt3Question', value)}
            onAnswer={set('prompt3')}
          />
        </FormSection>

        <View style={styles.actionBar}>
          <PrimaryButton variant="outline">Preview</PrimaryButton>
          <PrimaryButton onPress={saveChanges}>
            {saving ? 'Saving...' : 'Save changes'}
          </PrimaryButton>
        </View>

        <View style={styles.logoutSection}>
          <PrimaryButton variant="soft" onPress={logout}>
            Log out
          </PrimaryButton>
        </View>
      </ScrollView>
    </View>
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
    ? selectedCount > 0
      ? `${selectedCount} selected`
      : 'Select'
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

      <Pressable style={styles.selectField} onPress={() => setExpanded((current) => !current)}>
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
          {selectedValues.map((item) => (
            <Pressable key={item} style={styles.selectedChip} onPress={() => onToggle?.(item)}>
              <Text style={styles.selectedChipText}>{item}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {expanded ? (
        <View style={styles.dropdown}>
          {options.map((option) => {
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 54,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 18,
    marginBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 250,
  },
  completionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 18,
  },
  completionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  completionPercent: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '900',
  },
  completionTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: 12,
  },
  completionFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  completionCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  optionBlock: {
    marginTop: 14,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  optionHeaderText: {
    flex: 1,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  optionHelper: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
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
  selectText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    paddingRight: 12,
  },
  selectPlaceholder: {
    color: colors.grayIcon,
  },
  selectedChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
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
  selectedChipText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
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
  dropdownOptionSelected: {
    backgroundColor: '#FFF7F8',
  },
  dropdownText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  dropdownTextSelected: {
    color: colors.primary,
  },
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
  visibilityCompact: {
    marginTop: 0,
    marginBottom: 0,
    width: 34,
    height: 34,
    paddingHorizontal: 0,
  },
  visibilityText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  promptBlock: {
    marginTop: 12,
  },
  actionBar: {
    gap: 14,
    marginTop: 30,
  },
  logoutSection: {
    marginTop: 18,
  },
});
