import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EditableField, EditableTextArea, FormSection, PhotoUploadGrid } from '@/components/form';
import { colors, IconButton, PrimaryButton } from '@/design/system';
import {
  getCurrentAppUser,
  getMyPhotos,
  updateMyProfileData,
  type AppUser,
  type RelationshipGoal,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';

type ProfileDraft = {
  city: string;
  bio: string;
  height: string;
  education: string;
  jobTitle: string;
  company: string;
  relationshipGoal: RelationshipGoal | '';
  drinking: string;
  smoking: string;
  mbti: string;
  constellation: string;
  prompt1: string;
  prompt2: string;
};

const emptyDraft: ProfileDraft = {
  city: '',
  bio: '',
  height: '',
  education: '',
  jobTitle: '',
  company: '',
  relationshipGoal: '',
  drinking: '',
  smoking: '',
  mbti: '',
  constellation: '',
  prompt1: '',
  prompt2: '',
};

const relationshipGoalOptions: Array<{ label: string; value: RelationshipGoal }> = [
  { label: 'Long-term relationship', value: 'SERIOUS' },
  { label: 'Casual dating', value: 'CASUAL' },
  { label: 'New friends', value: 'FRIENDSHIP' },
  { label: 'Still figuring it out', value: 'UNDECIDED' },
];

function draftFromUser(user: AppUser): ProfileDraft {
  const profile = user.profile;

  return {
    city: user.city ?? '',
    bio: user.bio ?? '',
    height: profile?.height != null ? String(profile.height) : '',
    education: profile?.education ?? '',
    jobTitle: profile?.jobTitle ?? '',
    company: profile?.company ?? '',
    relationshipGoal: profile?.relationshipGoal ?? '',
    drinking: profile?.drinking ?? '',
    smoking: profile?.smoking ?? '',
    mbti: profile?.mbti ?? '',
    constellation: profile?.constellation ?? '',
    prompt1: profile?.prompt1 ?? '',
    prompt2: profile?.prompt2 ?? '',
  };
}

export default function MyProfileScreen() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [photoSlots, setPhotoSlots] = useState<Array<string | null>>(Array(6).fill(null));
  const [primaryVerified, setPrimaryVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasLoadedRef = useRef(false);

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
          const [{ user: appUser }, photos] = await Promise.all([
            getCurrentAppUser(session.access_token),
            getMyPhotos(session.access_token),
          ]);

          if (!cancelled) {
            setUser(appUser);
            setDraft(draftFromUser(appUser));
            const sorted = [
              ...photos.filter(p => p.isPrimary),
              ...photos.filter(p => !p.isPrimary),
            ];
            const slots: Array<string | null> = Array(6).fill(null);
            sorted.forEach((p, i) => { if (i < 6) slots[i] = p.url; });
            setPhotoSlots(slots);
            setPrimaryVerified(photos.find(p => p.isPrimary)?.isVerified ?? false);
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
      const result = await updateMyProfileData(session.access_token, {
        city: draft.city || null,
        bio: draft.bio || null,
        height: draft.height ? Number(draft.height) : null,
        education: draft.education || null,
        jobTitle: draft.jobTitle || null,
        company: draft.company || null,
        relationshipGoal: draft.relationshipGoal || null,
        drinking: draft.drinking || null,
        smoking: draft.smoking || null,
        mbti: draft.mbti || null,
        constellation: draft.constellation || null,
        prompt1: draft.prompt1 || null,
        prompt2: draft.prompt2 || null,
      });

      const nextUser: AppUser = {
        ...result.user,
        profile: result.profile,
      };

      setUser(nextUser);
      setDraft(draftFromUser(nextUser));
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (error) {
      setSaving(false);
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

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My profile</Text>
            <Text style={styles.subtitle}>
              {loading ? 'Loading profile...' : 'Edit the details stored in your backend profile'}
            </Text>
          </View>
          <IconButton icon="settings-outline" />
        </View>

        <PhotoUploadGrid photos={photoSlots} primaryVerified={primaryVerified} />

        <FormSection title="Account">
          <EditableField label="Name" value={user?.name ?? ''} />
          <EditableField label="Email" value={user?.email ?? ''} />
          <EditableField label="Gender" value={user?.gender ?? ''} />
          <EditableField label="Birthday" value={birthdayDisplay} />
        </FormSection>

        <FormSection title="Profile details" helper="These fields save to /api/v1/profiles/me.">
          <EditableField label="City" value={draft.city} onChangeText={set('city')} />
          <EditableField label="Height (cm)" value={draft.height} onChangeText={set('height')} />
          <EditableField label="Education" value={draft.education} onChangeText={set('education')} />
          <EditableField label="Job title" value={draft.jobTitle} onChangeText={set('jobTitle')} />
          <EditableField label="Company" value={draft.company} onChangeText={set('company')} />
          <EditableField label="Drinking" value={draft.drinking} onChangeText={set('drinking')} />
          <EditableField label="Smoking" value={draft.smoking} onChangeText={set('smoking')} />
          <EditableField label="MBTI" value={draft.mbti} onChangeText={set('mbti')} />
          <EditableField
            label="Constellation"
            value={draft.constellation}
            onChangeText={set('constellation')}
          />
        </FormSection>

        <FormSection title="Relationship goal">
          <View style={styles.optionGrid}>
            {relationshipGoalOptions.map((goal) => {
              const selected = draft.relationshipGoal === goal.value;

              return (
                <Text
                  key={goal.value}
                  onPress={() => set('relationshipGoal')(goal.value)}
                  style={[styles.optionPill, selected && styles.optionPillSelected]}
                >
                  {goal.label}
                </Text>
              );
            })}
          </View>
        </FormSection>

        <FormSection title="Bio">
          <EditableTextArea
            value={draft.bio}
            onChangeText={set('bio')}
            placeholder="Tell people a little about you..."
          />
        </FormSection>

        <FormSection title="Prompts">
          <EditableTextArea
            value={draft.prompt1}
            onChangeText={set('prompt1')}
            placeholder="A perfect weekend is..."
          />
          <EditableTextArea
            value={draft.prompt2}
            onChangeText={set('prompt2')}
            placeholder="I get along best with..."
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
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionPill: {
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  optionPillSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    color: '#FFFFFF',
  },
  actionBar: {
    gap: 12,
    marginTop: 28,
  },
  logoutSection: {
    marginTop: 16,
  },
});
