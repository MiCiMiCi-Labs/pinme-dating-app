import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/auth';
import { colors, PrimaryButton } from '@/design/system';
import {
  birthdayInputToIso,
  formatBirthdayInput,
  getAgeFromBirthdayInput,
  isoToBirthdayInput,
} from '@/lib/birthday';
import {
  getMyPhotos,
  getMyProfile,
  syncAuthUser,
  updateMyLocation,
  updateMyPreferences,
  updateMyProfileData,
  uploadPhoto,
  type Gender,
  type RelationshipGoal,
} from '@/lib/api';
import { createPhotoThumbnail } from '@/lib/photos';
import { searchCities, type CitySuggestion } from '@/lib/places';
import { setProfileCompletion } from '@/stores/profileCompletion.store';
import { showToast } from '@/stores/toast.store';

type StepId = 'basics' | 'interested' | 'goal' | 'photos' | 'city' | 'bio';
type LocationConsent = 'allowed' | 'denied' | null;
type PreciseLocation = {
  latitude: number;
  longitude: number;
} | null;

type PhotoSlot = {
  uri: string;
  mimeType: string;
  remote?: boolean;
} | null;

type ProfileForm = {
  name: string;
  birthday: string;
  gender: Gender | '';
  genderChoice: string;
  interestedIn: string;
  relationshipGoal: string;
  city: string;
  bio: string;
};

const steps: Array<{ id: StepId; label: string }> = [
  { id: 'basics', label: 'Basics' },
  { id: 'interested', label: 'Meet' },
  { id: 'goal', label: 'Goal' },
  { id: 'photos', label: 'Photos' },
  { id: 'city', label: 'City' },
  { id: 'bio', label: 'Bio' },
];

const initialForm: ProfileForm = {
  name: '',
  birthday: '',
  gender: '',
  genderChoice: '',
  interestedIn: '',
  relationshipGoal: '',
  city: '',
  bio: '',
};

const genderOptions: Array<{ id: string; label: string; value: Gender }> = [
  { id: 'woman', label: 'Woman', value: 'FEMALE' },
  { id: 'man', label: 'Man', value: 'MALE' },
  { id: 'non-binary', label: 'Non-binary', value: 'NON_BINARY' },
  { id: 'self-describe', label: 'Self-describe', value: 'SELF_DESCRIBE' },
  { id: 'prefer-not', label: 'Prefer not to say', value: 'PREFER_NOT_TO_SAY' },
];

const interestedOptions: Array<{ id: string; label: string; value: Gender | null }> = [
  { id: 'women', label: 'Women', value: 'FEMALE' },
  { id: 'men', label: 'Men', value: 'MALE' },
  { id: 'non-binary-people', label: 'Non-binary people', value: 'NON_BINARY' },
  { id: 'everyone', label: 'Everyone', value: null },
];

const relationshipGoalOptions: Array<{
  id: string;
  label: string;
  value: RelationshipGoal;
}> = [
  { id: 'long-term', label: 'Long-term relationship', value: 'LONG_TERM' },
  {
    id: 'serious-open',
    label: 'A serious relationship, but open to short-term',
    value: 'SERIOUS_OPEN_TO_SHORT_TERM',
  },
  { id: 'casual', label: 'Casual dating', value: 'CASUAL' },
  { id: 'friendship', label: 'Friendship', value: 'FRIENDSHIP' },
  { id: 'figuring-out', label: 'Still figuring it out', value: 'UNDECIDED' },
];

const emptyPhotos: PhotoSlot[] = [null, null, null, null, null, null];
const minimumPhotos = 2;
const maximumBioLength = 500;

function buildCityLabel(place: Location.LocationGeocodedAddress) {
  const city = place.city ?? place.subregion ?? place.region;
  return [city, place.country].filter(Boolean).join(', ');
}

export default function CompleteProfileScreen() {
  const { session, markProfileComplete } = useAuth();
  const [step, setStep] = useState<StepId>('basics');
  const [form, setForm] = useState<ProfileForm>(initialForm);
  const [selectedCityPlaceId, setSelectedCityPlaceId] = useState<string | null>(null);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [citySearchLoading, setCitySearchLoading] = useState(false);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);
  const [locationConsent, setLocationConsent] = useState<LocationConsent>(null);
  const [preciseLocation, setPreciseLocation] = useState<PreciseLocation>(null);
  const [photos, setPhotos] = useState<PhotoSlot[]>(emptyPhotos);
  const [loadingExistingProfile, setLoadingExistingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentStepIndex = steps.findIndex((item) => item.id === step);
  const birthdayAge = useMemo(() => getAgeFromBirthdayInput(form.birthday), [form.birthday]);
  const selectedPhotoCount = photos.filter(Boolean).length;
  const bioLength = form.bio.length;

  const updateField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    const accessToken = session?.access_token;
    if (!accessToken) return;
    const token = accessToken;

    let cancelled = false;
    setLoadingExistingProfile(true);

    async function loadExistingProfile() {
      try {
        try {
          await syncAuthUser(token, { createIfMissing: false });
        } catch {
          // Existing accounts may already be synced; do not block loading profile/photos.
        }

        const [{ user, profile }, existingPhotos] = await Promise.all([
          getMyProfile(token),
          getMyPhotos(token).catch(() => []),
        ]);

        if (cancelled) return;

        setForm((current) => ({
          ...current,
          name: user.name ?? '',
          birthday: isoToBirthdayInput(user.birthday),
          gender: (user.gender as Gender | null) ?? '',
          genderChoice:
            user.gender === 'FEMALE'
              ? 'woman'
              : user.gender === 'MALE'
                ? 'man'
                : user.gender === 'NON_BINARY'
                  ? 'non-binary'
                : user.gender === 'SELF_DESCRIBE'
                  ? 'self-describe'
                  : user.gender === 'PREFER_NOT_TO_SAY'
                    ? 'prefer-not'
                    : user.gender === 'OTHER'
                      ? 'self-describe'
                    : '',
          city: user.city ?? '',
          bio: user.bio ?? '',
          relationshipGoal: getRelationshipGoalId(profile?.relationshipGoal),
        }));

        if (user.city) {
          setSelectedCityPlaceId('saved-city');
        }

        if (existingPhotos.length > 0) {
          const nextPhotos = [...emptyPhotos];
          existingPhotos.slice(0, nextPhotos.length).forEach((photo, index) => {
            nextPhotos[index] = { uri: photo.url, mimeType: 'image/jpeg', remote: true };
          });
          setPhotos(nextPhotos);
        }
      } catch {
        // New users can reach this screen before profile data exists.
      } finally {
        if (!cancelled) {
          setLoadingExistingProfile(false);
        }
      }
    }

    loadExistingProfile();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

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

  const updateCity = (value: string) => {
    updateField('city', value);
    setSelectedCityPlaceId(null);
    setCitySearchError(null);
  };

  const selectCity = (suggestion: CitySuggestion) => {
    updateField('city', suggestion.label);
    setSelectedCityPlaceId(suggestion.placeId);
    setCitySuggestions([]);
    setCitySearchError(null);
  };

  const requestCurrentLocation = async () => {
    setError(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        setLocationConsent('denied');
        return;
      }

      setLocationConsent('allowed');
      const currentLocation = await Location.getCurrentPositionAsync({});
      setPreciseLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      const [place] = await Location.reverseGeocodeAsync(currentLocation.coords);
      const cityLabel = place ? buildCityLabel(place) : '';

      if (cityLabel) {
        updateField('city', cityLabel);
        setSelectedCityPlaceId('device-location');
        setCitySuggestions([]);
      }
    } catch {
      setError('Could not detect your city. Please choose it from the list.');
    }
  };

  const pickPhoto = async (index: number) => {
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError('Photo access is required to upload profile photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
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

  const validateStep = (stepToValidate: StepId) => {
    if (stepToValidate === 'basics') {
      if (!form.name.trim()) return 'Please enter your name or nickname.';
      if (!form.birthday.trim()) return 'Please enter your birthday.';
      if (birthdayAge == null) return 'Birthday must be a valid date, e.g. 01-01-2000.';
      if (birthdayAge < 18) return 'You must be at least 18 to use PinMe.';
      if (!form.genderChoice || !form.gender) {
        return 'Please choose how you describe your gender.';
      }
    }

    if (stepToValidate === 'interested' && !form.interestedIn) {
      return 'Please choose who you are interested in meeting.';
    }

    if (stepToValidate === 'goal' && !form.relationshipGoal) {
      return 'Please choose what you are looking for.';
    }

    if (stepToValidate === 'photos' && selectedPhotoCount < minimumPhotos) {
      return `Please add at least ${minimumPhotos} photos.`;
    }

    if (stepToValidate === 'city') {
      if (!form.city.trim()) return 'Please choose your city.';
      if (!selectedCityPlaceId) return 'Please choose a city from the suggestions.';
    }

    if (stepToValidate === 'bio') {
      if (!form.bio.trim()) return 'Please write a short bio.';
      if (form.bio.length > maximumBioLength) {
        return `Bio must be ${maximumBioLength} characters or less.`;
      }
    }

    return null;
  };

  const goNext = () => {
    const validationError = validateStep(step);

    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    if (currentStepIndex < steps.length - 1) {
      setStep(steps[currentStepIndex + 1].id);
    }
  };

  const goBack = () => {
    setError(null);

    if (currentStepIndex > 0) {
      setStep(steps[currentStepIndex - 1].id);
    }
  };

  const saveProfile = async () => {
    setError(null);

    for (const item of steps) {
      const validationError = validateStep(item.id);
      if (validationError) {
        setStep(item.id);
        setError(validationError);
        return;
      }
    }

    const accessToken = session?.access_token;

    if (!accessToken) {
      setError('Please log in again before completing your profile.');
      return;
    }

    const selectedInterest = interestedOptions.find((option) => option.id === form.interestedIn);
    const selectedGoal = relationshipGoalOptions.find((option) => option.id === form.relationshipGoal);

    if (!selectedInterest || !selectedGoal || !form.gender) {
      setError('Please complete all required questions.');
      return;
    }

    const birthdayIso = birthdayInputToIso(form.birthday);

    if (!birthdayIso) {
      setStep('basics');
      setError('Birthday must be a valid date, e.g. 01-01-2000.');
      return;
    }

    setSaving(true);

    try {
      try {
        await syncAuthUser(accessToken, {
          name: form.name.trim(),
          birthday: birthdayIso,
          gender: form.gender,
        });
      } catch {
        // Existing accounts can still save profile if sync endpoint is temporarily unavailable.
      }

      await updateMyProfileData(accessToken, {
        name: form.name.trim(),
        birthday: birthdayIso,
        gender: form.gender,
        city: form.city.trim(),
        bio: form.bio.trim(),
        relationshipGoal: selectedGoal.value,
      });

      await updateMyPreferences(accessToken, {
        preferredGender: selectedInterest.value,
      });

      if (preciseLocation) {
        await updateMyLocation(accessToken, {
          latitude: preciseLocation.latitude,
          longitude: preciseLocation.longitude,
          city: form.city.trim(),
        });
      }

      const localPhotos = photos.filter((photo): photo is Exclude<PhotoSlot, null> =>
        Boolean(photo && !photo.remote)
      );

      for (const photo of localPhotos) {
        const thumbnail = await createPhotoThumbnail(photo.uri);
        await uploadPhoto(accessToken, photo.uri, photo.mimeType, thumbnail);
      }

      const complete = await markProfileComplete();

      if (!complete) {
        setError('Profile is still incomplete. Please check the required fields.');
        return;
      }

      setProfileCompletion({
        percent: 100,
        completed: 1,
        total: 1,
        missingFields: [],
      });
      showToast('Profile completed', 'success');
      router.replace('/(main)/discover');
    } catch (profileError) {
      setError(
        profileError instanceof Error ? profileError.message : 'Failed to complete your profile'
      );
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    if (step === 'basics') {
      return (
        <View style={styles.stepBody}>
          <QuestionHeader title="What's your name?" subtitle="Use the name or nickname you want people to see." />
          <FormField label="Name / nickname">
            <TextInput
              value={form.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder="Mia"
              placeholderTextColor={colors.grayIcon}
              style={styles.input}
            />
          </FormField>

          <QuestionHeader title="When's your birthday?" subtitle="We calculate your age automatically from your birthday." compact />
          <FormField label="Birthday">
            <TextInput
              value={form.birthday}
              onChangeText={(value) => updateField('birthday', formatBirthdayInput(value))}
              placeholder="01-01-2000"
              placeholderTextColor={colors.grayIcon}
              keyboardType="number-pad"
              style={styles.input}
            />
          </FormField>
          {birthdayAge != null ? (
            <Text style={styles.hint}>Your age will show as {birthdayAge}.</Text>
          ) : null}

          <QuestionHeader title="How do you describe your gender?" compact />
          <View style={styles.optionList}>
            {genderOptions.map((option) => {
              return (
                <OptionRow
                  key={option.id}
                  label={option.label}
                  selected={form.genderChoice === option.id}
                  onPress={() => {
                    updateField('gender', option.value);
                    updateField('genderChoice', option.id);
                  }}
                />
              );
            })}
          </View>
        </View>
      );
    }

    if (step === 'interested') {
      return (
        <View style={styles.stepBody}>
          <QuestionHeader title="Who are you interested in meeting?" />
          <View style={styles.optionList}>
            {interestedOptions.map((option) => (
              <OptionRow
                key={option.id}
                label={option.label}
                selected={form.interestedIn === option.id}
                onPress={() => updateField('interestedIn', option.id)}
              />
            ))}
          </View>
        </View>
      );
    }

    if (step === 'goal') {
      return (
        <View style={styles.stepBody}>
          <QuestionHeader title="What are you looking for?" />
          <View style={styles.optionList}>
            {relationshipGoalOptions.map((option) => (
              <OptionRow
                key={option.id}
                label={option.label}
                selected={form.relationshipGoal === option.id}
                onPress={() => updateField('relationshipGoal', option.id)}
              />
            ))}
          </View>
        </View>
      );
    }

    if (step === 'photos') {
      return (
        <View style={styles.stepBody}>
          <QuestionHeader
            title="Add photos that show the real you."
            subtitle="Add at least 2-3 photos. Your first photo becomes your main profile photo."
          />
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
                    <Text style={styles.emptyPhotoText}>
                      {index === 0 ? 'Main photo' : 'Add photo'}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>{selectedPhotoCount} of {minimumPhotos} required photos added.</Text>
        </View>
      );
    }

    if (step === 'city') {
      return (
        <View style={styles.stepBody}>
          <QuestionHeader
            title="Where are you currently based?"
            subtitle="Your exact location is saved privately for distance matching. Other people only see your general area, such as Auckland."
          />

          <View style={styles.locationCard}>
            <View style={styles.locationTextBlock}>
              <Text style={styles.locationTitle}>Allow location access?</Text>
              <Text style={styles.locationCopy}>
                We can use it to save your private coordinates and suggest your current city.
              </Text>
            </View>
            <Pressable style={styles.locationButton} onPress={requestCurrentLocation}>
              <Text style={styles.locationButtonText}>
                {locationConsent === 'allowed' ? 'Allowed' : 'Allow'}
              </Text>
            </Pressable>
          </View>

          {locationConsent === 'denied' ? (
            <Text style={styles.hint}>Location was not allowed. Choose your city from the list instead.</Text>
          ) : null}

          <View style={styles.cityFieldWrap}>
            <FormField label="City" selected={Boolean(selectedCityPlaceId)}>
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
            </FormField>

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

            {citySearchLoading ? <Text style={styles.hint}>Searching cities...</Text> : null}
            {citySearchError ? <Text style={styles.hint}>{citySearchError}</Text> : null}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.stepBody}>
        <QuestionHeader
          title="Tell us a little about yourself."
          subtitle="Keep it friendly and specific. Aim for about 300-500 characters."
        />
        <FormField label="Bio">
          <TextInput
            value={form.bio}
            onChangeText={(value) => updateField('bio', value.slice(0, maximumBioLength))}
            placeholder="I love weekend markets, quiet coffee spots, and discovering new music..."
            placeholderTextColor={colors.grayIcon}
            multiline
            style={[styles.input, styles.bioInput]}
          />
        </FormField>
        <Text style={styles.hint}>{bioLength}/{maximumBioLength} characters</Text>
      </View>
    );
  };

  if (loadingExistingProfile) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
            <Text style={styles.eyebrow}>Step {currentStepIndex + 1} of {steps.length}</Text>
            <View style={styles.progressRow}>
              {steps.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.progressDot,
                    index <= currentStepIndex && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>
          </View>

          {renderStep()}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.footer}>
            {currentStepIndex > 0 ? (
              <Pressable style={styles.backButton} onPress={saving ? undefined : goBack}>
                <Ionicons name="chevron-back" size={18} color={colors.primary} />
                <Text style={styles.backButtonText}>Back</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <View style={styles.primaryAction}>
              <PrimaryButton
                onPress={
                  saving
                    ? undefined
                    : currentStepIndex === steps.length - 1
                      ? saveProfile
                      : goNext
                }
              >
                {saving
                  ? 'Saving profile...'
                  : currentStepIndex === steps.length - 1
                    ? 'Save and start'
                    : 'Continue'}
              </PrimaryButton>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function QuestionHeader({
  title,
  subtitle,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.questionHeader, compact && styles.questionHeaderCompact]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.copy}>{subtitle}</Text> : null}
    </View>
  );
}

function FormField({
  label,
  selected = false,
  children,
}: {
  label: string;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.field, selected && styles.fieldSelected]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.optionRow, selected && styles.optionRowSelected]} onPress={onPress}>
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? '#FFFFFF' : colors.grayIcon}
      />
    </Pressable>
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
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 34,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: 20,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 10,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 8,
  },
  progressDot: {
    flex: 1,
    height: 4,
    borderRadius: 4,
    backgroundColor: colors.line,
  },
  progressDotActive: {
    backgroundColor: colors.primary,
  },
  stepBody: {
    flex: 1,
  },
  questionHeader: {
    marginBottom: 20,
  },
  questionHeaderCompact: {
    marginTop: 26,
    marginBottom: 14,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
  },
  field: {
    minHeight: 64,
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
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 12,
  },
  optionList: {
    gap: 10,
  },
  optionRow: {
    minHeight: 58,
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
  optionRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  optionText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    paddingRight: 12,
  },
  optionTextSelected: {
    color: '#FFFFFF',
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
    textAlign: 'center',
  },
  locationCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    marginBottom: 12,
  },
  locationTextBlock: {
    flex: 1,
  },
  locationTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  locationCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  locationButton: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  locationButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  cityFieldWrap: {
    marginTop: 2,
  },
  cityInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  bioInput: {
    minHeight: 160,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 18,
  },
  footer: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    marginTop: 24,
  },
  backButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '900',
  },
  primaryAction: {
    flex: 1,
  },
});
function getRelationshipGoalId(goal: RelationshipGoal | null | undefined) {
  if (goal === 'SERIOUS') return 'serious-open';
  return relationshipGoalOptions.find((option) => option.value === goal)?.id ?? '';
}
