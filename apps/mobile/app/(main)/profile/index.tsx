import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EditableField, EditableTextArea, FormSection, PhotoUploadGrid } from '@/components/form';
import { colors, IconButton, PrimaryButton } from '@/design/system';
import {
  getCurrentAppUser,
  getMyPhotos,
  updateMyProfileData,
  type AppUser,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';

const MAX_SLOTS = 6;

type ProfileDraft = {
  jobTitle: string;
  company: string;
  education: string;
  height: string;
  relationshipGoal: string;
  drinking: string;
  smoking: string;
  mbti: string;
  constellation: string;
  prompt1: string;
  prompt2: string;
};

const emptyDraft: ProfileDraft = {
  jobTitle: '',
  company: '',
  education: '',
  height: '',
  relationshipGoal: '',
  drinking: '',
  smoking: '',
  mbti: '',
  constellation: '',
  prompt1: '',
  prompt2: '',
};

function draftFromUser(user: AppUser): ProfileDraft {
  const p = user.profile;
  return {
    jobTitle: p?.jobTitle ?? '',
    company: p?.company ?? '',
    education: p?.education ?? '',
    height: p?.height != null ? String(p.height) : '',
    relationshipGoal: p?.relationshipGoal ?? '',
    drinking: p?.drinking ?? '',
    smoking: p?.smoking ?? '',
    mbti: p?.mbti ?? '',
    constellation: p?.constellation ?? '',
    prompt1: p?.prompt1 ?? '',
    prompt2: p?.prompt2 ?? '',
  };
}

export default function MyProfileScreen() {
  const [photoSlots, setPhotoSlots] = useState<Array<string | null>>(Array(MAX_SLOTS).fill(null));
  const [user, setUser] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        try {
          const [photos, { user: appUser }] = await Promise.all([
            getMyPhotos(session.access_token),
            getCurrentAppUser(session.access_token),
          ]);
          const slots: Array<string | null> = Array(MAX_SLOTS).fill(null);
          photos.forEach((p, i) => { if (i < MAX_SLOTS) slots[i] = p.url; });
          setPhotoSlots(slots);
          setUser(appUser);
          setDraft(draftFromUser(appUser));
        } catch {
          // keep existing state on error
        }
      })();
    }, [])
  );

  const set = (key: keyof ProfileDraft) => (value: string) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  const validate = (): string | null => {
    if (draft.height) {
      const h = parseInt(draft.height, 10);
      if (isNaN(h) || h < 90 || h > 250) {
        return 'Height must be a number between 90 and 250.';
      }
    }
    if (draft.mbti && draft.mbti.length > 4) {
      return 'MBTI type should be 4 characters or fewer (e.g. INFJ).';
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setSaving(true);
    try {
      await updateMyProfileData(session.access_token, {
        jobTitle: draft.jobTitle || null,
        company: draft.company || null,
        education: draft.education || null,
        height: draft.height ? parseInt(draft.height, 10) : null,
        relationshipGoal: draft.relationshipGoal || null,
        drinking: draft.drinking || null,
        smoking: draft.smoking || null,
        mbti: draft.mbti || null,
        constellation: draft.constellation || null,
        prompt1: draft.prompt1 || null,
        prompt2: draft.prompt2 || null,
      });
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  const birthdayDisplay = user?.birthday
    ? new Date(user.birthday).toLocaleDateString()
    : '';

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My profile</Text>
            <Text style={styles.subtitle}>Photos, personal details, and dating preferences</Text>
          </View>
          <IconButton icon="settings-outline" />
        </View>

        <PhotoUploadGrid photos={photoSlots} />

        <FormSection title="Basic info">
          <EditableField label="Name" value={user?.name ?? ''} />
          <EditableField label="Email" value={user?.email ?? ''} />
          <EditableField label="Gender" value={user?.gender ?? ''} />
          <EditableField label="Birthday" value={birthdayDisplay} />
        </FormSection>

        <FormSection title="Profile details" helper="Tap a field to edit.">
          <EditableField label="Job title" value={draft.jobTitle} onChangeText={set('jobTitle')} />
          <EditableField label="Company" value={draft.company} onChangeText={set('company')} />
          <EditableField label="Education" value={draft.education} onChangeText={set('education')} />
          <EditableField label="Height (cm)" value={draft.height} onChangeText={set('height')} />
          <EditableField label="Relationship goal" value={draft.relationshipGoal} onChangeText={set('relationshipGoal')} />
          <EditableField label="Drinking" value={draft.drinking} onChangeText={set('drinking')} />
          <EditableField label="Smoking" value={draft.smoking} onChangeText={set('smoking')} />
          <EditableField label="MBTI" value={draft.mbti} onChangeText={set('mbti')} />
          <EditableField label="Constellation" value={draft.constellation} onChangeText={set('constellation')} />
        </FormSection>

        <FormSection title="Prompts">
          <EditableTextArea
            value={draft.prompt1}
            onChangeText={set('prompt1')}
            placeholder="Tell people something about yourself…"
          />
          <EditableTextArea
            value={draft.prompt2}
            onChangeText={set('prompt2')}
            placeholder="Add a second prompt…"
          />
        </FormSection>

        <View style={styles.actionBar}>
          <PrimaryButton variant="outline">Preview</PrimaryButton>
          <PrimaryButton onPress={saveChanges}>
            {saving ? 'Saving…' : 'Save changes'}
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
  actionBar: {
    gap: 12,
    marginTop: 28,
  },
  logoutSection: {
    marginTop: 16,
  },
});
