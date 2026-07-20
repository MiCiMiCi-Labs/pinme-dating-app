// In-memory only — reset on every account switch via resetSwipedUsers()
// (see AuthCacheBoundary in app/_layout.tsx). 'pending' means a swipe request
// is in flight and is hiding the card optimistically; 'confirmed' means the
// server has actually recorded it. Only a 'pending' entry can be rolled back,
// so a failed request never permanently hides someone the server never saw.
type SwipeStatus = 'pending' | 'confirmed';

const statusById = new Map<string, SwipeStatus>();

export function markSwipedPending(id: string) {
  if (statusById.get(id) !== 'confirmed') {
    statusById.set(id, 'pending');
  }
}

export function confirmSwiped(id: string) {
  statusById.set(id, 'confirmed');
}

export function unmarkSwipedIfPending(id: string) {
  if (statusById.get(id) === 'pending') {
    statusById.delete(id);
  }
}

export function filterSwiped<T extends { id: string }>(arr: T[]): T[] {
  return arr.filter((u) => !statusById.has(u.id));
}

export function resetSwipedUsers() {
  statusById.clear();
}
