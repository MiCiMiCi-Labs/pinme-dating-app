import { atom } from 'nanostores';

export type MatchSuccessEvent = {
  id: string;
  matchId: string;
  userId: string;
  userName: string;
  photoUrl?: string;
  createdAt: number;
};

export type MatchEventsState = {
  latestMatch: MatchSuccessEvent | null;
  pendingMatchRefresh: boolean;
};

export const $matchEvents = atom<MatchEventsState>({
  latestMatch: null,
  pendingMatchRefresh: false,
});

export function registerMatchSuccess(event: Omit<MatchSuccessEvent, 'id' | 'createdAt'>) {
  $matchEvents.set({
    latestMatch: {
      ...event,
      id: `${event.matchId}:${Date.now()}`,
      createdAt: Date.now(),
    },
    pendingMatchRefresh: true,
  });
}

export function markMatchRefreshHandled() {
  $matchEvents.set({
    ...$matchEvents.get(),
    pendingMatchRefresh: false,
  });
}

export function clearMatchSuccess() {
  $matchEvents.set({
    latestMatch: null,
    pendingMatchRefresh: false,
  });
}
