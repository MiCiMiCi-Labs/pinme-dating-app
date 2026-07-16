import { type DiscoveryUser } from './api';

const discoveryUsers = new Map<string, DiscoveryUser>();

export function cacheDiscoveryUsers(users: DiscoveryUser[]) {
  users.forEach((user) => {
    discoveryUsers.set(user.id, user);
  });
}

export function getCachedDiscoveryUser(userId: string | undefined): DiscoveryUser | null {
  if (!userId) return null;
  return discoveryUsers.get(userId) ?? null;
}
