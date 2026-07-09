import { type AppUser, type RelationshipGoal } from '@/lib/api';

export type { Photo } from '@/lib/api';

export type ProfileDraft = {
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

export const emptyDraft: ProfileDraft = {
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

function normalizeRelationshipGoal(goal: RelationshipGoal | null | undefined): RelationshipGoal | '' {
  if (goal === 'SERIOUS') return 'SERIOUS_OPEN_TO_SHORT_TERM';
  return goal ?? '';
}

export function draftFromUser(user: AppUser): ProfileDraft {
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
