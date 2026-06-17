import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/contexts/auth';
import { colors, PrimaryButton } from '@/design/system';
import { updateMyProfileData, uploadPhoto, type RelationshipGoal } from '@/lib/api';
import { searchCities, type CitySuggestion } from '@/lib/places';

type ProfileForm = {
  city: string;
  height: string;
  education: string;
  jobTitle: string;
  company: string;
  relationshipGoal: string;
  bio: string;
  prompt1: string;
  prompt2: string;
};

const initialForm: ProfileForm = {
  city: '',
  height: '',
  education: '',
  jobTitle: '',
  company: '',
  relationshipGoal: '',
  bio: '',
  prompt1: '',
  prompt2: '',
};

const requiredFields: Array<{ key: keyof ProfileForm; label: string; placeholder: string }> = [
  { key: 'city', label: 'City', placeholder: 'Auckland' },
  { key: 'education', label: 'Education', placeholder: 'University' },
  { key: 'jobTitle', label: 'Job title', placeholder: 'Product designer' },
  { key: 'bio', label: 'Bio', placeholder: 'Tell people a little about you' },
  { key: 'prompt1', label: 'Prompt 1', placeholder: 'A perfect weekend is...' },
  { key: 'prompt2', label: 'Prompt 2', placeholder: 'I get along best with...' },
];

const relationshipGoalOptions: Array<{ label: string; value: RelationshipGoal }> = [
  { label: 'Long-term relationship', value: 'SERIOUS' },
  { label: 'Casual dating', value: 'CASUAL' },
  { label: 'New friends', value: 'FRIENDSHIP' },
  { label: 'Still figuring it out', value: 'UNDECIDED' },
];

export default function CompleteProfileScreen() {
  const { session, markProfileComplete } = useAuth();
  const [form, setForm] = useState<ProfileForm>(initialForm);
  const [selectedCityPlaceId, setSelectedCityPlaceId] = useState<string | null>(null);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [citySearchLoading, setCitySearchLoading] = useState(false);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Array<{ uri: string; mimeType: string } | null>>([null, null, null, null, null, null]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedPhotoCount = photos.filter(Boolean).length;
  const detailFields = useMemo(() => requiredFields.filter((field) => field.key !== 'city'), []);

  const updateField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateCity = (value: string) => {
    updateField('city', value);
    setSelectedCityPlaceId(null);
    setCitySearchError(null);
  };

  const updateHeight = (value: string) => {
    updateField('height', value.replace(/\D/g, '').slice(0, 3));
  };

  const selectCity = (suggestion: CitySuggestion) => {
    updateField('city', suggestion.label);
    setSelectedCityPlaceId(suggestion.placeId);
    setCitySuggestions([]);
    setCitySearchError(null);
  };

  useEffect(() => {
    const query = form.city.trim();

    if (selectedCityPlaceId || query.length < 2) {
      setCitySuggestions([]);
      setCitySearchLoading(false);
      return;
    }

    let cancelled = false;
    setCitySearchLoading(true);

    const timeout = setTimeout(async () => {
      try {
        const suggestions = await searchCities(query);

        if (!cancelled) {
          setCitySuggestions(suggestions);
          setCitySearchError(null);
        }
      } catch (cityError) {
        if (!cancelled) {
          setCitySuggestions([]);
          setCitySearchError(
            cityError instanceof Error ? cityError.message : 'Failed to load city suggestions'
          );
        }
      } finally {
        if (!cancelled) {
          setCitySearchLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [form.city, selectedCityPlaceId]);

  const pickPhoto = async (index: number) => {
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError('Photo access is required to upload profile photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.85,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    setPhotos((current) => {
      const next = [...current];
      next[index] = { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
      return next;
    });
  };

  const continueToApp = async () => {
    setError(null);

    const accessToken = session?.access_token;

    if (!accessToken) {
      setError('Please log in again before completing your profile.');
      return;
    }

    const missingField = requiredFields.find(({ key }) => !form[key].trim());

    if (missingField) {
      setError(`${missingField.label} is required`);
      return;
    }

    if (!selectedCityPlaceId) {
      setError('Please choose a city from the suggestions.');
      return;
    }

    const heightInCm = Number(form.height);

    if (!Number.isInteger(heightInCm) || heightInCm < 120 || heightInCm > 230) {
      setError('Height must be between 120 and 230 cm.');
      return;
    }

    const relationshipGoal = relationshipGoalOptions.find(
      (option) => option.value === form.relationshipGoal
    );

    if (!relationshipGoal) {
      setError('Please choose a relationship goal.');
      return;
    }

    setSaving(true);

    try {
      await updateMyProfileData(accessToken, {
        city: form.city,
        bio: form.bio,
        height: heightInCm,
        education: form.education,
        jobTitle: form.jobTitle,
        company: form.company || null,
        relationshipGoal: relationshipGoal.value,
        prompt1: form.prompt1,
        prompt2: form.prompt2,
      });

      const selectedPhotos = photos.filter(Boolean) as Array<{ uri: string; mimeType: string }>;
      for (const photo of selectedPhotos) {
        try {
          await uploadPhoto(accessToken, photo.uri, photo.mimeType);
        } catch (_) {
          // Don't block profile completion on photo upload failures
        }
      }

      const complete = await markProfileComplete();

      if (!complete) {
        setError('Profile is still incomplete. Please fill all required fields.');
        return;
      }

      router.replace('/(main)/discover');
    } catch (profileError) {
      setSaving(false);
      setError(
        profileError instanceof Error ? profileError.message : 'Failed to complete your profile'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <Text style={styles.eyebrow}>One last step</Text>
            <Text style={styles.title}>Complete your profile</Text>
            <Text style={styles.copy}>
              Add the details and photos people need before you start discovering matches.
            </Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.counter}>
                {selectedPhotoCount > 0 ? `${selectedPhotoCount} selected` : 'Optional'}
              </Text>
            </View>
            <View style={styles.photoGrid}>
              {photos.map((photo, index) => (
                <Pressable
                  key={`photo-${index}`}
                  onPress={() => pickPhoto(index)}
                  style={[styles.photoSlot, index === 0 && styles.primaryPhoto]}
                >
                  {photo ? (
                    <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
                  ) : (
                    <View style={styles.emptyPhoto}>
                      <Ionicons name="camera-outline" size={25} color={colors.primary} />
                      <Text style={styles.emptyPhotoText}>{index === 0 ? 'Primary' : 'Add'}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile details</Text>
            <View style={styles.cityFieldWrap}>
              <View style={[styles.field, selectedCityPlaceId && styles.fieldSelected]}>
                <Text style={styles.label}>City</Text>
                <View style={styles.cityInputRow}>
                  <TextInput
                    value={form.city}
                    onChangeText={updateCity}
                    placeholder="Start typing your city"
                    placeholderTextColor={colors.grayIcon}
                    style={styles.input}
                  />
                  {selectedCityPlaceId ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : null}
                </View>
              </View>

              {citySuggestions.length > 0 ? (
                <View style={styles.suggestionMenu}>
                  {citySuggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion.placeId}
                      onPress={() => selectCity(suggestion)}
                      style={styles.suggestionItem}
                    >
                      <Ionicons name="location-outline" size={18} color={colors.primary} />
                      <View style={styles.suggestionTextWrap}>
                        <Text style={styles.suggestionMain}>{suggestion.mainText}</Text>
                        {suggestion.secondaryText ? (
                          <Text style={styles.suggestionSecondary}>{suggestion.secondaryText}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {citySearchLoading ? <Text style={styles.cityHint}>Searching cities...</Text> : null}
              {citySearchError ? <Text style={styles.cityHint}>{citySearchError}</Text> : null}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Height</Text>
              <View style={styles.unitInputRow}>
                <TextInput
                  value={form.height}
                  onChangeText={updateHeight}
                  keyboardType="number-pad"
                  placeholder="168"
                  placeholderTextColor={colors.grayIcon}
                  style={styles.input}
                />
                <Text style={styles.unitLabel}>cm</Text>
              </View>
            </View>

            <View style={styles.optionSection}>
              <Text style={styles.label}>Relationship goal</Text>
              <View style={styles.optionGrid}>
                {relationshipGoalOptions.map((goal) => {
                  const selected = form.relationshipGoal === goal.value;

                  return (
                    <Pressable
                      key={goal.value}
                      onPress={() => updateField('relationshipGoal', goal.value)}
                      style={[styles.optionPill, selected && styles.optionPillSelected]}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {goal.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {detailFields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  value={form[field.key]}
                  onChangeText={(value) => updateField(field.key, value)}
                  multiline={field.key === 'bio' || field.key === 'prompt1' || field.key === 'prompt2'}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.grayIcon}
                  style={[
                    styles.input,
                    (field.key === 'bio' || field.key === 'prompt1' || field.key === 'prompt2') &&
                      styles.textAreaInput,
                  ]}
                />
              </View>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton onPress={saving ? undefined : continueToApp} style={styles.button}>
            {saving ? 'Saving profile...' : 'Continue to Discover'}
          </PrimaryButton>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 38,
  },
  header: {
    marginBottom: 24,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
    marginBottom: 12,
  },
  counter: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoSlot: {
    width: '31.3%',
    aspectRatio: 0.78,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: '#FAFAFB',
  },
  primaryPhoto: {
    width: '64.2%',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  emptyPhoto: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyPhotoText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  field: {
    minHeight: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  fieldSelected: {
    borderColor: colors.primary,
  },
  cityFieldWrap: {
    marginBottom: 12,
  },
  cityInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unitInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unitLabel: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  optionSection: {
    marginTop: 4,
    marginBottom: 12,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  optionPill: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  optionPillSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  optionTextSelected: {
    color: '#FFFFFF',
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: 6,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
  },
  suggestionMenu: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    marginTop: -4,
    marginBottom: 12,
  },
  suggestionItem: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionMain: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  suggestionSecondary: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  cityHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 12,
  },
  textAreaInput: {
    minHeight: 74,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 18,
  },
  button: {
    marginTop: 22,
  },
});
