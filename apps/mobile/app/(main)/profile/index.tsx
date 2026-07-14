import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { colors } from '@/design/system';
import { type AppUser, type Photo } from '@/lib/api';
import { getDetailedProfileCompletion } from '@/lib/profileCompleteness';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/queries/user.queries';
import { useMyPhotos, useUpdateMyProfile } from '@/queries/profile.queries';
import { ProfileDraft, emptyDraft, draftFromUser } from '@/components/profile/types';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileStrengthCard } from '@/components/profile/ProfileStrengthCard';
import { PhotoSummary } from '@/components/profile/PhotoSummary';
import { ProfileSections } from '@/components/profile/ProfileSections';
import { ProfileActions } from '@/components/profile/ProfileActions';
import { ProfileSettingsSheet } from '@/components/profile/ProfileSettingsSheet';
import { setProfileCompletion } from '@/stores/profileCompletion.store';
import { showToast } from '@/stores/toast.store';

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function MyProfileScreen() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customInterest, setCustomInterest] = useState('');
  const currentUserQuery = useCurrentUser();
  const photosQuery = useMyPhotos();
  const updateProfileMutation = useUpdateMyProfile();
  const loading = currentUserQuery.isLoading || photosQuery.isLoading;

  useEffect(() => {
    if (!currentUserQuery.data?.user) return;
    setUser(currentUserQuery.data.user);
    setDraft(draftFromUser(currentUserQuery.data.user));
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

  const primaryVerified = useMemo(
    () => photos.find(p => p.isPrimary)?.isVerified ?? false,
    [photos],
  );

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

  const validate = () => {
    if (draft.height) {
      const height = Number(draft.height);
      if (!Number.isInteger(height) || height < 120 || height > 230) {
        return 'Height must be between 120 and 230 cm.';
      }
    }
    if (draft.mbti && draft.mbti.length > 4) return 'MBTI should be 4 characters or fewer.';
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

  const birthdayDisplay = user?.birthday ? new Date(user.birthday).toLocaleDateString() : '';

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <ProfileHeader loading={loading} onSettingsPress={() => setSettingsOpen(true)} />
        <ProfileStrengthCard percent={completion.percent} loading={loading} />
        <PhotoSummary photos={photoSlots} primaryVerified={primaryVerified} loading={loading} />
        <ProfileSections
          user={user}
          draft={draft}
          loading={loading}
          customInterest={customInterest}
          birthdayDisplay={birthdayDisplay}
          set={set}
          setBoolean={setBoolean}
          toggleHiddenField={toggleHiddenField}
          setSingleOption={setSingleOption}
          toggleListItem={toggleListItem}
          addCustomInterest={addCustomInterest}
          setCustomInterest={setCustomInterest}
        />
        <ProfileActions saving={saving} onSave={saveChanges} />
      </ScrollView>
      <ProfileSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onManagePhotos={() => router.push('/(main)/profile/photos')}
        onBlockedUsers={() => router.push('/(main)/profile/blocked')}
        onLogout={logout}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, paddingTop: 54, paddingBottom: 32 },
});
