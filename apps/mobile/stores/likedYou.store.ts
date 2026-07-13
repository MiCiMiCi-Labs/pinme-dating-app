import { atom } from 'nanostores';

export const $hiddenLikedUserIds = atom<Set<string>>(new Set());

export function hideLikedUser(userId: string) {
  const next = new Set($hiddenLikedUserIds.get());
  next.add(userId);
  $hiddenLikedUserIds.set(next);
}

export function restoreLikedUser(userId: string) {
  const next = new Set($hiddenLikedUserIds.get());
  next.delete(userId);
  $hiddenLikedUserIds.set(next);
}

export function resetHiddenLikedUsers() {
  $hiddenLikedUserIds.set(new Set());
}
