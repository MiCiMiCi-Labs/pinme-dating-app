import { computed, map } from 'nanostores';

export type PendingMessageState = 'sending' | 'failed';

export type ChatEventsState = {
  activeMatchId: string | null;
  pendingMessageIds: Record<string, PendingMessageState>;
  chatNeedsRefreshByMatchId: Record<string, boolean>;
  unreadCountByMatchId: Record<string, number>;
  lastIncomingMessage: {
    matchId: string;
    messageId: string;
    senderId: string | null;
    createdAt: string;
  } | null;
};

export const $chatEvents = map<ChatEventsState>({
  activeMatchId: null,
  pendingMessageIds: {},
  chatNeedsRefreshByMatchId: {},
  unreadCountByMatchId: {},
  lastIncomingMessage: null,
});

export const $totalUnreadCount = computed($chatEvents, (events) =>
  Object.values(events.unreadCountByMatchId).reduce((total, count) => total + count, 0)
);

export function setActiveMatch(matchId: string | null) {
  $chatEvents.setKey('activeMatchId', matchId);
}

export function setPendingMessage(messageId: string, state: PendingMessageState) {
  $chatEvents.setKey('pendingMessageIds', {
    ...$chatEvents.get().pendingMessageIds,
    [messageId]: state,
  });
}

export function clearPendingMessage(messageId: string) {
  const next = { ...$chatEvents.get().pendingMessageIds };
  delete next[messageId];
  $chatEvents.setKey('pendingMessageIds', next);
}

export function markChatNeedsRefresh(matchId: string) {
  $chatEvents.setKey('chatNeedsRefreshByMatchId', {
    ...$chatEvents.get().chatNeedsRefreshByMatchId,
    [matchId]: true,
  });
}

export function markChatRefreshHandled(matchId: string) {
  const next = { ...$chatEvents.get().chatNeedsRefreshByMatchId };
  delete next[matchId];
  $chatEvents.setKey('chatNeedsRefreshByMatchId', next);
}

export function setUnreadCount(matchId: string, count: number) {
  $chatEvents.setKey('unreadCountByMatchId', {
    ...$chatEvents.get().unreadCountByMatchId,
    [matchId]: Math.max(0, count),
  });
}

export function setUnreadCounts(counts: Record<string, number>) {
  $chatEvents.setKey('unreadCountByMatchId', counts);
}

export function clearUnreadCount(matchId: string) {
  const next = { ...$chatEvents.get().unreadCountByMatchId };
  delete next[matchId];
  $chatEvents.setKey('unreadCountByMatchId', next);
}

export function registerIncomingMessage(message: ChatEventsState['lastIncomingMessage']) {
  if (!message) return;

  $chatEvents.setKey('lastIncomingMessage', message);

  if ($chatEvents.get().activeMatchId !== message.matchId) {
    markChatNeedsRefresh(message.matchId);
  }
}

export function resetChatEvents() {
  $chatEvents.set({
    activeMatchId: null,
    pendingMessageIds: {},
    chatNeedsRefreshByMatchId: {},
    unreadCountByMatchId: {},
    lastIncomingMessage: null,
  });
}
