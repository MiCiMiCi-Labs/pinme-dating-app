import { type DiscoveryUser, type PublicUser } from './api';

const discoveryUsers = new Map<string, PublicUser>();

function toPublicUser(user: DiscoveryUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    age: user.age,
    gender: user.gender,
    bio: user.bio,
    city: user.city,
    profile: user.profile,
    photos: user.photos,
  };
}

export function cacheDiscoveryUsers(users: DiscoveryUser[]) {
  users.forEach((user) => {
    discoveryUsers.set(user.id, toPublicUser(user));
  });
}

export function getCachedDiscoveryUser(userId: string | undefined) {
  if (!userId) return null;
  return discoveryUsers.get(userId) ?? null;
}
