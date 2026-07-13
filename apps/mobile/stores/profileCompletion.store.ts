import { computed, atom } from 'nanostores';
import { matchingProfileCompletionThreshold } from '@/lib/profileCompleteness';

export type ProfileCompletionState = {
  percent: number | null;
  completed: number;
  total: number;
  missingFields: string[];
};

export const $profileCompletion = atom<ProfileCompletionState>({
  percent: null,
  completed: 0,
  total: 0,
  missingFields: [],
});

export const $canAccessDiscovery = computed(
  $profileCompletion,
  (completion) =>
    completion.percent !== null &&
    completion.percent >= matchingProfileCompletionThreshold
);

export function setProfileCompletion(completion: Partial<ProfileCompletionState>) {
  $profileCompletion.set({
    ...$profileCompletion.get(),
    ...completion,
  });
}

export function resetProfileCompletion() {
  $profileCompletion.set({
    percent: null,
    completed: 0,
    total: 0,
    missingFields: [],
  });
}
