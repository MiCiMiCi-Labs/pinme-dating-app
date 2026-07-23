import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, IconButton, TextButton } from '@/design/system';
import { type AppUser, type Gender, type Photo, type RelationshipGoal } from '@/lib/api';
import { getDetailedProfileCompletion } from '@/lib/profileCompleteness';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { useCurrentUser, useDeleteAccount, usePrivacySettings, useUpdatePrivacySettings } from '@/queries/user.queries';
import { useMyPhotos, useUpdateMyProfile } from '@/queries/profile.queries';
import { ProfileDraft, emptyDraft, draftFromUser } from '@/components/profile/types';
import { ProfileSettingsSheet } from '@/components/profile/ProfileSettingsSheet';
import {
  CityField,
  MultiSelectField,
  ProfileCompletionBar,
  ProfileEditSectionModal,
  ProfileField,
  ProfileSectionRow,
  PromptCard,
  SelectField,
  VisibilityControl,
  type ProfileSectionKey,
} from '@/components/profile/ProfileEditComponents';
import type { CitySuggestion } from '@/lib/places';
import { setProfileCompletion } from '@/stores/profileCompletion.store';
import { showToast } from '@/stores/toast.store';

const genderOptions: Array<{ label: string; value: Gender }> = [
  { label: 'Woman', value: 'FEMALE' },
  { label: 'Man', value: 'MALE' },
  { label: 'Non-binary', value: 'NON_BINARY' },
  { label: 'Self-describe', value: 'SELF_DESCRIBE' },
  { label: 'Prefer not to say', value: 'PREFER_NOT_TO_SAY' },
];

const relationshipGoalOptions: Array<{ label: string; value: RelationshipGoal }> = [
  { label: 'Long-term relationship', value: 'LONG_TERM' },
  { label: 'Serious, open to short-term', value: 'SERIOUS_OPEN_TO_SHORT_TERM' },
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

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function valueCount(values: Array<string | null | undefined>) {
  return values.filter(value => Boolean(String(value ?? '').trim())).length;
}

function listSummary(values: string[], empty = 'Not added') {
  if (!values.length) return empty;
  if (values.length <= 2) return values.join(', ');
  return `${values.slice(0, 2).join(', ')} +${values.length - 2}`;
}

function labelForValue<T extends string>(options: Array<{ label: string; value: T }>, value: T | '') {
  return options.find(option => option.value === value)?.label ?? '';
}

function formatAge(birthday?: string | null) {
  if (!birthday) return null;
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age -= 1;
  return age;
}

export default function MyProfileScreen() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<ProfileSectionKey | null>(null);
  const [activePrompt, setActivePrompt] = useState<1 | 2 | 3 | null>(null);
  const [customInterest, setCustomInterest] = useState('');
  const [selectedCityPlaceId, setSelectedCityPlaceId] = useState<string | null>(null);
  const currentUserQuery = useCurrentUser();
  const photosQuery = useMyPhotos();
  const updateProfileMutation = useUpdateMyProfile();
  const privacySettingsQuery = usePrivacySettings();
  const updatePrivacyMutation = useUpdatePrivacySettings();
  const deleteAccountMutation = useDeleteAccount();
  const loading = currentUserQuery.isLoading || photosQuery.isLoading;

  useEffect(() => {
    if (!currentUserQuery.data?.user) return;
    setUser(currentUserQuery.data.user);
    setDraft(draftFromUser(currentUserQuery.data.user));
    // Whatever's already saved is trusted as valid until the user edits it —
    // 'saved-city' is just a sentinel, not a real place id (mirrors the same
    // pattern in (auth)/complete-profile.tsx's onboarding city step).
    setSelectedCityPlaceId(currentUserQuery.data.user.city ? 'saved-city' : null);
  }, [currentUserQuery.data?.user]);

  useEffect(() => {
    if (!photosQuery.data) return;
    setPhotos(photosQuery.data);
  }, [photosQuery.data]);

  useEffect(() => {
    const error = currentUserQuery.error ?? photosQuery.error;
    if (!error) return;
    Alert.alert(
      'Profile error',
      error instanceof Error ? error.message : 'Failed to load profile.',
    );
  }, [currentUserQuery.error, photosQuery.error]);

  const photoSlots = useMemo(() => {
    const sorted = [
      ...photos.filter(p => p.isPrimary),
      ...photos.filter(p => !p.isPrimary),
    ];
    const slots: Array<string | null> = Array(6).fill(null);
    sorted.forEach((photo, index) => {
      if (index < slots.length) slots[index] = getDisplayPhotoUrl(photo, 'thumbnail');
    });
    return slots;
  }, [photos]);

  const primaryPhoto = useMemo(() => {
    const primary = photos.find(photo => photo.isPrimary) ?? photos[0];
    return primary ? getDisplayPhotoUrl(primary, 'thumbnail') : null;
  }, [photos]);

  const completion = useMemo(
    () => getDetailedProfileCompletion(user, photos),
    [user, photos],
  );

  useEffect(() => {
    setProfileCompletion(completion);
  }, [completion]);

  const set = (key: keyof ProfileDraft) => (value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const setBoolean = (key: 'companyVisible' | 'sexualOrientationVisible') => (value: boolean) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const toggleHiddenField = (field: string) => {
    if (field === 'relationshipStyle') return;
    setDraft(current => {
      const hidden = new Set(current.hiddenFields);
      if (hidden.has(field)) { hidden.delete(field); } else { hidden.add(field); }
      return { ...current, hiddenFields: Array.from(hidden) };
    });
  };

  const setSingleOption = (key: keyof ProfileDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const toggleListItem = (key: 'languages' | 'interests', value: string) => {
    setDraft(current => {
      const list = current[key];
      const exists = list.includes(value);
      if (!exists && key === 'interests' && list.length >= 8) return current;
      return { ...current, [key]: exists ? list.filter(item => item !== value) : [...list, value] };
    });
  };

  const addCustomInterest = () => {
    const value = customInterest.trim();
    if (!value) return;
    setDraft(current => {
      if (current.interests.includes(value) || current.interests.length >= 8) return current;
      return { ...current, interests: [...current.interests, value] };
    });
    setCustomInterest('');
  };

  const updateCity = (value: string) => {
    setDraft(current => ({ ...current, city: value }));
    setSelectedCityPlaceId(null);
  };

  const selectCitySuggestion = (suggestion: CitySuggestion) => {
    setDraft(current => ({ ...current, city: suggestion.label }));
    setSelectedCityPlaceId(suggestion.placeId);
  };

  const validate = () => {
    if (!draft.name.trim()) return 'Name is required.';
    if (draft.city.trim() && !selectedCityPlaceId) {
      return 'Please choose your city from the suggestions.';
    }
    if (draft.birthday) {
      const birthday = new Date(draft.birthday);
      if (Number.isNaN(birthday.getTime())) return 'Birthday must be a valid date, e.g. 2000-01-01.';
    }
    if (draft.height) {
      const height = Number(draft.height);
      if (!Number.isInteger(height) || height < 120 || height > 230) {
        return 'Height must be between 120 and 230 cm.';
      }
    }
    if (draft.mbti && draft.mbti.length > 18) return 'MBTI should be a valid option.';
    if (draft.interests.length > 0 && draft.interests.length < 3) {
      return 'Choose 3–8 interests, or leave interests empty for now.';
    }
    return null;
  };

  const saveChanges = async () => {
    if (saving) return;
    const validationError = validate();
    if (validationError) { Alert.alert('Invalid input', validationError); return; }

    setSaving(true);
    try {
      const hiddenFields = draft.hiddenFields.filter(f => f !== 'relationshipStyle');
      const result = await updateProfileMutation.mutateAsync({
        name: draft.name.trim(),
        birthday: draft.birthday.trim(),
        gender: draft.gender || undefined,
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

      const nextUser: AppUser = { ...result.user, profile: result.profile };
      setUser(nextUser);
      setDraft(draftFromUser(nextUser));
      setSelectedCityPlaceId(nextUser.city ? 'saved-city' : null);
      setActiveSection(null);
      showToast('Profile saved', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account, matches, messages, and photos. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            deleteAccountMutation.mutate(undefined, {
              onSuccess: async () => {
                await supabase.auth.signOut();
                router.replace('/(auth)/login');
              },
              onError: (error) => {
                showToast(error instanceof Error ? error.message : 'Failed to delete account.', 'error');
              },
            });
          },
        },
      ]
    );
  };

  const toggleShowOnlineStatus = (value: boolean) => {
    updatePrivacyMutation.mutate(
      { showOnlineStatus: value },
      {
        onError: () => showToast('Could not update online status setting.', 'error'),
      }
    );
  };

  const completedPrompts = [
    [draft.prompt1Question, draft.prompt1],
    [draft.prompt2Question, draft.prompt2],
    [draft.prompt3Question, draft.prompt3],
  ].filter(([question, answer]) => question && answer).length;

  const sectionSummaries = {
    photos: `${photos.length}/6 photos`,
    essentials: [
      draft.name,
      draft.birthday,
      draft.gender ? labelForValue(genderOptions, draft.gender) : '',
      draft.city,
      draft.height ? `${draft.height} cm` : '',
    ].filter(Boolean).join(' · ') || 'Add name, birthday, city and bio',
    about: listSummary([
      draft.pronouns,
      draft.jobTitle,
      draft.educationLevel || draft.education,
      draft.languages.length ? `${draft.languages.length} languages` : '',
    ].filter(Boolean), 'Add work, education and identity details'),
    lifestyle: `${valueCount([draft.smoking, draft.drinking, draft.exercise, draft.dietary, draft.pets])}/8 added`,
    relationship: labelForValue(relationshipGoalOptions, draft.relationshipGoal) || 'Add what you are looking for',
    interests: draft.interests.length ? `${draft.interests.length}/8 interests` : 'Choose 3–8 interests',
    prompts: completedPrompts ? `${completedPrompts}/3 prompts` : 'Add prompts',
  };

  const sectionStatus = {
    photos: photos.length >= 3 ? 'Complete' : 'Add more',
    essentials: `${valueCount([draft.name, draft.birthday, draft.gender, draft.city, draft.height, draft.bio])}/6`,
    about: `${valueCount([draft.pronouns, draft.sexualOrientation, draft.education, draft.educationLevel, draft.jobTitle, draft.company, draft.hometown, draft.constellation, draft.mbti]) + (draft.languages.length ? 1 : 0)}/10`,
    lifestyle: `${valueCount([draft.smoking, draft.drinking, draft.exercise, draft.dietary, draft.drugs, draft.pets, draft.sleepHabit, draft.socialHabit])}/8`,
    relationship: `${valueCount([draft.relationshipGoal, draft.relationshipStyle, draft.children, draft.wantsChildren, draft.communicationStyle, draft.idealFirstDate])}/6`,
    interests: `${draft.interests.length}/8`,
    prompts: `${completedPrompts}/3`,
  };

  const age = formatAge(user?.birthday);
  const titleName = draft.name || user?.name || 'Your profile';

  const openPhotos = () => router.push('/(main)/profile/photos');
  const previewProfile = () => {
    if (!user?.id) return;
    router.push({ pathname: '/(main)/discover/[userId]', params: { userId: user.id, source: 'preview' } });
  };

  const hiddenToggle = (field: string) => (
    <VisibilityControl
      visible={!draft.hiddenFields.includes(field)}
      onChange={() => toggleHiddenField(field)}
    />
  );

  const renderSection = () => {
    switch (activeSection) {
      case 'essentials':
        return (
          <>
            <ProfileField label="Name" value={draft.name} onChangeText={set('name')} placeholder="Your name" />
            <ProfileField label="Birthday" value={draft.birthday} onChangeText={set('birthday')} placeholder="YYYY-MM-DD" helper="Your age is calculated from your birthday." />
            <SelectField
              label="Gender"
              value={labelForValue(genderOptions, draft.gender)}
              options={genderOptions.map(option => option.label)}
              onSelect={label => setSingleOption('gender', genderOptions.find(option => option.label === label)?.value ?? '')}
            />
            <CityField
              label="City"
              value={draft.city}
              onChangeText={updateCity}
              onSelectSuggestion={selectCitySuggestion}
              isValidSelection={Boolean(selectedCityPlaceId)}
            />
            <ProfileField label="Height" value={draft.height} onChangeText={set('height')} placeholder="170" keyboardType="number-pad" helper="Use centimeters. 120–230 cm." />
            <ProfileField label="Bio" value={draft.bio} onChangeText={set('bio')} multiline placeholder="Tell people a little about yourself..." helper={`${draft.bio.length}/500 recommended`} />
          </>
        );
      case 'about':
        return (
          <>
            <SelectField label="Pronouns" value={draft.pronouns} options={pronounOptions} onSelect={v => setSingleOption('pronouns', v)} />
            {hiddenToggle('pronouns')}
            <SelectField label="Sexual orientation" value={draft.sexualOrientation} options={orientationOptions} onSelect={v => setSingleOption('sexualOrientation', v)} helper="Sensitive and optional." />
            <VisibilityControl visible={draft.sexualOrientationVisible} onChange={setBoolean('sexualOrientationVisible')} />
            <SelectField label="Education" value={draft.educationLevel} options={educationLevelOptions} onSelect={v => setSingleOption('educationLevel', v)} />
            {hiddenToggle('educationLevel')}
            <ProfileField label="School" value={draft.education} onChangeText={set('education')} placeholder="Where did you study?" />
            <ProfileField label="Occupation" value={draft.jobTitle} onChangeText={set('jobTitle')} placeholder="What do you do?" />
            {hiddenToggle('jobTitle')}
            <ProfileField label="Workplace" value={draft.company} onChangeText={set('company')} placeholder="Where do you work?" helper="Company is hidden by default." />
            <VisibilityControl visible={draft.companyVisible} onChange={setBoolean('companyVisible')} />
            <MultiSelectField label="Languages" values={draft.languages} options={languageOptions} onToggle={v => toggleListItem('languages', v)} />
            {hiddenToggle('languages')}
            <ProfileField label="Hometown" value={draft.hometown} onChangeText={set('hometown')} placeholder="Where are you originally from?" />
            {hiddenToggle('hometown')}
            <SelectField label="Star sign" value={draft.constellation} options={constellationOptions} onSelect={v => setSingleOption('constellation', v)} />
            {hiddenToggle('constellation')}
            <SelectField label="MBTI" value={draft.mbti} options={mbtiOptions} onSelect={v => setSingleOption('mbti', v)} />
            {hiddenToggle('mbti')}
          </>
        );
      case 'lifestyle':
        return (
          <>
            <SelectField label="Smoking" value={draft.smoking} options={smokingOptions} onSelect={v => setSingleOption('smoking', v)} />
            {hiddenToggle('smoking')}
            <SelectField label="Drinking" value={draft.drinking} options={drinkingOptions} onSelect={v => setSingleOption('drinking', v)} />
            {hiddenToggle('drinking')}
            <SelectField label="Exercise" value={draft.exercise} options={exerciseOptions} onSelect={v => setSingleOption('exercise', v)} />
            {hiddenToggle('exercise')}
            <SelectField label="Dietary preferences" value={draft.dietary} options={dietaryOptions} onSelect={v => setSingleOption('dietary', v)} />
            {hiddenToggle('dietary')}
            <SelectField label="Drug use" value={draft.drugs} options={drugsOptions} onSelect={v => setSingleOption('drugs', v)} />
            {hiddenToggle('drugs')}
            <SelectField label="Pets" value={draft.pets} options={petsOptions} onSelect={v => setSingleOption('pets', v)} />
            {hiddenToggle('pets')}
            <SelectField label="Sleep" value={draft.sleepHabit} options={sleepOptions} onSelect={v => setSingleOption('sleepHabit', v)} />
            {hiddenToggle('sleepHabit')}
            <SelectField label="Social style" value={draft.socialHabit} options={socialOptions} onSelect={v => setSingleOption('socialHabit', v)} />
            {hiddenToggle('socialHabit')}
          </>
        );
      case 'relationship':
        return (
          <>
            <SelectField
              label="Looking for"
              value={labelForValue(relationshipGoalOptions, draft.relationshipGoal)}
              options={relationshipGoalOptions.map(option => option.label)}
              onSelect={label => setSingleOption('relationshipGoal', relationshipGoalOptions.find(option => option.label === label)?.value ?? '')}
            />
            <SelectField label="Relationship style" value={draft.relationshipStyle} options={relationshipStyleOptions} onSelect={v => setSingleOption('relationshipStyle', v)} />
            <VisibilityControl visible onChange={() => {}} locked />
            <SelectField label="Children" value={draft.children} options={childrenOptions} onSelect={v => setSingleOption('children', v)} />
            {hiddenToggle('children')}
            <SelectField label="Future plans" value={draft.wantsChildren} options={wantsChildrenOptions} onSelect={v => setSingleOption('wantsChildren', v)} />
            {hiddenToggle('wantsChildren')}
            <SelectField label="Communication" value={draft.communicationStyle} options={communicationOptions} onSelect={v => setSingleOption('communicationStyle', v)} />
            {hiddenToggle('communicationStyle')}
            <ProfileField label="Ideal first date" value={draft.idealFirstDate} onChangeText={set('idealFirstDate')} multiline placeholder="What would be a great first date?" />
            {hiddenToggle('idealFirstDate')}
          </>
        );
      case 'interests':
        return (
          <>
            <MultiSelectField
              label="Selected interests"
              values={draft.interests}
              options={interestOptions}
              onToggle={v => toggleListItem('interests', v)}
              helper="Choose 3–8 interests. You can add your own."
              customValue={customInterest}
              onCustomValueChange={setCustomInterest}
              onAddCustom={addCustomInterest}
            />
            {hiddenToggle('interests')}
            <ProfileField label="Ideal weekend" value={draft.weekend} onChangeText={set('weekend')} multiline placeholder="What does your ideal weekend look like?" />
            {hiddenToggle('weekend')}
            <ProfileField label="Music, movies, food" value={draft.favorites} onChangeText={set('favorites')} multiline placeholder="What are you into?" />
            {hiddenToggle('favorites')}
          </>
        );
      case 'prompts': {
        const questionKey = activePrompt === 1 ? 'prompt1Question' : activePrompt === 2 ? 'prompt2Question' : 'prompt3Question';
        const answerKey = activePrompt === 1 ? 'prompt1' : activePrompt === 2 ? 'prompt2' : 'prompt3';
        return (
          <>
            <Text style={styles.sectionIntro}>Add up to three prompts. Empty prompts stay compact until you open them.</Text>
            {[1, 2, 3].map(index => {
              const i = index as 1 | 2 | 3;
              const q = i === 1 ? draft.prompt1Question : i === 2 ? draft.prompt2Question : draft.prompt3Question;
              const a = i === 1 ? draft.prompt1 : i === 2 ? draft.prompt2 : draft.prompt3;
              return (
                <PromptCard
                  key={i}
                  index={i}
                  question={q}
                  answer={a}
                  onPress={() => setActivePrompt(activePrompt === i ? null : i)}
                />
              );
            })}
            {activePrompt ? (
              <View style={styles.promptEditor}>
                <SelectField
                  label="Prompt"
                  value={draft[questionKey]}
                  options={promptOptions}
                  onSelect={v => setSingleOption(questionKey, v)}
                />
                <ProfileField
                  label="Answer"
                  value={draft[answerKey]}
                  onChangeText={set(answerKey)}
                  multiline
                  placeholder="Write a short answer..."
                />
              </View>
            ) : null}
          </>
        );
      }
      default:
        return null;
    }
  };

  const sectionTitle = {
    photos: 'Photos',
    essentials: 'Profile essentials',
    about: 'About me',
    lifestyle: 'Lifestyle',
    relationship: 'Relationship goals',
    interests: 'Interests',
    prompts: 'Prompts',
  }[activeSection ?? 'essentials'];

  if (loading && !user) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} size={44} />
        <Text style={styles.title}>Edit profile</Text>
        <TextButton onPress={previewProfile}>Preview</TextButton>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Pressable style={styles.avatarWrap} onPress={openPhotos}>
            {primaryPhoto ? (
              <Image source={{ uri: primaryPhoto }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Ionicons name="camera-outline" size={28} color={colors.primary} />
              </View>
            )}
            <View style={styles.avatarEdit}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
          <View style={styles.heroText}>
            <Text style={styles.name}>{titleName}{age ? `, ${age}` : ''}</Text>
            <Text style={styles.city}>{draft.city || 'Add your city'}</Text>
          </View>
        </View>

        <ProfileCompletionBar percent={completion.percent} />

        <View style={styles.sectionGroup}>
          <ProfileSectionRow title="Photos" subtitle={sectionSummaries.photos} status={sectionStatus.photos} icon="images-outline" onPress={openPhotos} />
          <ProfileSectionRow title="Profile essentials" subtitle={sectionSummaries.essentials} status={sectionStatus.essentials} icon="person-outline" onPress={() => setActiveSection('essentials')} />
          <ProfileSectionRow title="About me" subtitle={sectionSummaries.about} status={sectionStatus.about} icon="sparkles-outline" onPress={() => setActiveSection('about')} />
          <ProfileSectionRow title="Lifestyle" subtitle={sectionSummaries.lifestyle} status={sectionStatus.lifestyle} icon="leaf-outline" onPress={() => setActiveSection('lifestyle')} />
          <ProfileSectionRow title="Relationship goals" subtitle={sectionSummaries.relationship} status={sectionStatus.relationship} icon="heart-outline" onPress={() => setActiveSection('relationship')} />
          <ProfileSectionRow title="Interests" subtitle={sectionSummaries.interests} status={sectionStatus.interests} icon="color-palette-outline" onPress={() => setActiveSection('interests')} />
          <ProfileSectionRow title="Prompts" subtitle={sectionSummaries.prompts} status={sectionStatus.prompts} icon="chatbubble-ellipses-outline" onPress={() => setActiveSection('prompts')} />
        </View>

        <Pressable style={styles.settingsRow} onPress={() => setSettingsOpen(true)}>
          <Ionicons name="settings-outline" size={19} color={colors.muted} />
          <Text style={styles.settingsText}>Account settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.grayIcon} />
        </Pressable>
      </ScrollView>

      <ProfileEditSectionModal
        visible={Boolean(activeSection && activeSection !== 'photos')}
        title={sectionTitle}
        saving={saving}
        onClose={() => setActiveSection(null)}
        onSave={saveChanges}
      >
        {renderSection()}
      </ProfileEditSectionModal>

      <ProfileSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onManagePhotos={() => router.push('/(main)/profile/photos')}
        onBlockedUsers={() => router.push('/(main)/profile/blocked')}
        onLogout={logout}
        onDeleteAccount={deleteAccount}
        showOnlineStatus={privacySettingsQuery.data?.showOnlineStatus ?? true}
        onToggleShowOnlineStatus={toggleShowOnlineStatus}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 18,
  },
  avatarWrap: {
    width: 88,
    height: 88,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 32,
    backgroundColor: '#F7F7FA',
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEdit: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  heroText: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  city: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 5,
  },
  sectionGroup: {
    gap: 10,
    borderRadius: 22,
    backgroundColor: '#F7F7FA',
    padding: 10,
    marginTop: 18,
  },
  settingsRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: '#F7F7FA',
    paddingHorizontal: 14,
    marginTop: 18,
  },
  settingsText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionIntro: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  promptEditor: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderWidth: 1,
    borderColor: '#ECECF1',
  },
});
