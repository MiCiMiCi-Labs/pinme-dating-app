import type { AppUser, Photo } from '@/lib/api';

const detailedProfileFields: Array<{
  key: string;
  isComplete: (user: AppUser, photos: Photo[]) => boolean;
}> = [
  { key: 'photos', isComplete: (_user, photos) => photos.length >= 3 },
  { key: 'bio', isComplete: (user) => Boolean(user.bio?.trim()) },
  { key: 'pronouns', isComplete: (user) => Boolean(user.profile?.pronouns?.trim()) },
  { key: 'sexualOrientation', isComplete: (user) => Boolean(user.profile?.sexualOrientation?.trim()) },
  { key: 'jobTitle', isComplete: (user) => Boolean(user.profile?.jobTitle?.trim()) },
  { key: 'education', isComplete: (user) => Boolean(user.profile?.education?.trim() || user.profile?.educationLevel?.trim()) },
  { key: 'height', isComplete: (user) => Boolean(user.profile?.height) },
  { key: 'languages', isComplete: (user) => Boolean(user.profile?.languages?.length) },
  { key: 'hometown', isComplete: (user) => Boolean(user.profile?.hometown?.trim()) },
  { key: 'personality', isComplete: (user) => Boolean(user.profile?.mbti?.trim() || user.profile?.constellation?.trim()) },
  { key: 'smoking', isComplete: (user) => Boolean(user.profile?.smoking?.trim()) },
  { key: 'drinking', isComplete: (user) => Boolean(user.profile?.drinking?.trim()) },
  { key: 'exercise', isComplete: (user) => Boolean(user.profile?.exercise?.trim()) },
  { key: 'dietary', isComplete: (user) => Boolean(user.profile?.dietary?.trim()) },
  { key: 'pets', isComplete: (user) => Boolean(user.profile?.pets?.trim()) },
  { key: 'sleepHabit', isComplete: (user) => Boolean(user.profile?.sleepHabit?.trim()) },
  { key: 'socialHabit', isComplete: (user) => Boolean(user.profile?.socialHabit?.trim()) },
  { key: 'children', isComplete: (user) => Boolean(user.profile?.children?.trim()) },
  { key: 'wantsChildren', isComplete: (user) => Boolean(user.profile?.wantsChildren?.trim()) },
  { key: 'relationshipStyle', isComplete: (user) => Boolean(user.profile?.relationshipStyle?.trim()) },
  { key: 'communicationStyle', isComplete: (user) => Boolean(user.profile?.communicationStyle?.trim()) },
  { key: 'idealFirstDate', isComplete: (user) => Boolean(user.profile?.idealFirstDate?.trim()) },
  { key: 'interests', isComplete: (user) => (user.profile?.interests?.length ?? 0) >= 3 },
  { key: 'weekend', isComplete: (user) => Boolean(user.profile?.weekend?.trim()) },
  { key: 'favorites', isComplete: (user) => Boolean(user.profile?.favorites?.trim()) },
  {
    key: 'prompts',
    isComplete: (user) =>
      [user.profile?.prompt1, user.profile?.prompt2, user.profile?.prompt3]
        .filter((value) => value?.trim()).length >= 2,
  },
];

export function getDetailedProfileCompletion(user: AppUser | null, photos: Photo[]) {
  if (!user) {
    return { percent: 0, completed: 0, total: detailedProfileFields.length };
  }

  const completed = detailedProfileFields.filter((field) => field.isComplete(user, photos)).length;
  const total = detailedProfileFields.length;

  return {
    percent: Math.round((completed / total) * 100),
    completed,
    total,
  };
}

export const matchingProfileCompletionThreshold = 80;
