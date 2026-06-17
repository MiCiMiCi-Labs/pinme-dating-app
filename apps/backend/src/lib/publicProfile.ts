const hideableFields = new Set([
  'pronouns',
  'sexualOrientation',
  'education',
  'educationLevel',
  'jobTitle',
  'languages',
  'hometown',
  'drinking',
  'smoking',
  'exercise',
  'dietary',
  'drugs',
  'pets',
  'sleepHabit',
  'socialHabit',
  'children',
  'wantsChildren',
  'communicationStyle',
  'idealFirstDate',
  'interests',
  'weekend',
  'favorites',
  'mbti',
  'constellation',
  'prompt1',
  'prompt2',
  'prompt3',
]);

type ProfileLike = Record<string, unknown> & {
  company?: string | null;
  companyVisible?: boolean | null;
  sexualOrientation?: string | null;
  sexualOrientationVisible?: boolean | null;
  hiddenFields?: string[] | null;
};

export function sanitizePublicProfile<TProfile extends ProfileLike | null>(
  profile: TProfile
) {
  if (!profile) return null;

  const publicProfile = { ...profile };
  const hiddenFields = new Set(profile.hiddenFields ?? []);

  if (!profile.companyVisible) {
    publicProfile.company = null;
  }

  if (!profile.sexualOrientationVisible) {
    publicProfile.sexualOrientation = null;
  }

  for (const field of hiddenFields) {
    if (hideableFields.has(field) && field !== 'relationshipStyle') {
      publicProfile[field] = null;
    }
  }

  publicProfile.hiddenFields = [];
  publicProfile.companyVisible = false;
  publicProfile.sexualOrientationVisible = false;

  return publicProfile;
}
