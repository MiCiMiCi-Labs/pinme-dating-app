import { type AppProfile } from './api';

export const profileValueLabels: Record<string, string> = {
  LONG_TERM: 'Long-term relationship',
  SERIOUS_OPEN_TO_SHORT_TERM: 'Serious, open to short-term',
  SERIOUS: 'Serious relationship',
  CASUAL: 'Casual dating',
  FRIENDSHIP: 'Friendship',
  UNDECIDED: 'Still figuring it out',
  SHORT_TERM: 'Short-term relationship',
  MONOGAMOUS: 'Monogamous',
  NON_MONOGAMOUS: 'Non-monogamous',
  OPEN_TO_DISCUSSING: 'Open to discussing',
  WANT_CHILDREN: 'Wants children',
  WANTS_CHILDREN: 'Wants children',
  NO_CHILDREN: 'No children',
  HAVE_CHILDREN: 'Has children',
  DOES_NOT_WANT_CHILDREN: 'Does not want children',
  NOT_SURE: 'Not sure',
  EARLY_BIRD: 'Early bird',
  NIGHT_OWL: 'Night owl',
  NO_PREFERENCE: 'No preference',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
  SELF_DESCRIBE: 'Self-describe',
};

export function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function formatProfileValue(value: unknown): string {
  if (!hasMeaningfulValue(value)) return '';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(formatProfileValue).filter(Boolean).join(' · ');

  const raw = String(value).trim();
  const explicit = profileValueLabels[raw.toUpperCase()];
  if (explicit) return explicit;

  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function isProfileFieldVisible(
  profile: AppProfile | null | undefined,
  field: string,
) {
  if (!profile) return false;
  if (field === 'company') return Boolean(profile.companyVisible);
  if (field === 'sexualOrientation') return Boolean(profile.sexualOrientationVisible);
  if (field === 'relationshipStyle') return true;
  return !profile.hiddenFields?.includes(field);
}

export function getVisibleProfileValue<T>(
  profile: AppProfile | null | undefined,
  field: string,
  value: T,
) {
  if (!hasMeaningfulValue(value)) return null;
  if (!isProfileFieldVisible(profile, field)) return null;
  return value;
}
