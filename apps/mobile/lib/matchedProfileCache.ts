import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicUser } from './api';

const CACHE_VERSION = 1;
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_PREFETCH_COUNT = 10;

type CachedMatchedProfile = {
  version: number;
  cachedAt: number;
  user: PublicUser;
};

function getCacheKey(viewerId: string, matchId: string) {
  return `pinme.matchedProfile.v${CACHE_VERSION}.${viewerId}.${matchId}`;
}

export function getMatchedProfilePrefetchLimit() {
  return MAX_PREFETCH_COUNT;
}

export async function readCachedMatchedProfile(viewerId: string, matchId: string) {
  try {
    const raw = await AsyncStorage.getItem(getCacheKey(viewerId, matchId));
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedMatchedProfile;
    if (cached.version !== CACHE_VERSION) return null;
    if (Date.now() - cached.cachedAt > MAX_AGE_MS) return null;

    return cached.user;
  } catch {
    return null;
  }
}

export async function writeCachedMatchedProfile(viewerId: string, matchId: string, user: PublicUser) {
  const cached: CachedMatchedProfile = {
    version: CACHE_VERSION,
    cachedAt: Date.now(),
    user,
  };

  try {
    await AsyncStorage.setItem(getCacheKey(viewerId, matchId), JSON.stringify(cached));
  } catch {
    // Matched profile cache should never block profile rendering.
  }
}
