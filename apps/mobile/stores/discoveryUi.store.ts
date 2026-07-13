import { map } from 'nanostores';

export type SwipeDirection = 'like' | 'nope';

export type DiscoveryUiState = {
  currentIndex: number;
  lastSwipeAction: SwipeDirection | null;
  swipeLocked: boolean;
  filterPanelOpen: boolean;
  discoveryNeedsRefresh: boolean;
};

export const $discoveryUi = map<DiscoveryUiState>({
  currentIndex: 0,
  lastSwipeAction: null,
  swipeLocked: false,
  filterPanelOpen: false,
  discoveryNeedsRefresh: false,
});

export function setDiscoveryCurrentIndex(currentIndex: number) {
  $discoveryUi.setKey('currentIndex', Math.max(0, currentIndex));
}

export function setDiscoverySwipeLocked(swipeLocked: boolean) {
  $discoveryUi.setKey('swipeLocked', swipeLocked);
}

export function setDiscoveryLastSwipeAction(lastSwipeAction: SwipeDirection | null) {
  $discoveryUi.setKey('lastSwipeAction', lastSwipeAction);
}

export function setDiscoveryFilterOpen(filterPanelOpen: boolean) {
  $discoveryUi.setKey('filterPanelOpen', filterPanelOpen);
}

export function markDiscoveryNeedsRefresh() {
  $discoveryUi.setKey('discoveryNeedsRefresh', true);
}

export function markDiscoveryRefreshHandled() {
  $discoveryUi.setKey('discoveryNeedsRefresh', false);
}

export function resetDiscoveryUi() {
  $discoveryUi.set({
    currentIndex: 0,
    lastSwipeAction: null,
    swipeLocked: false,
    filterPanelOpen: false,
    discoveryNeedsRefresh: false,
  });
}
