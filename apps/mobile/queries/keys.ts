export const queryKeys = {
  currentUser: ['user', 'current'] as const,
  myProfile: ['profile', 'me'] as const,
  myPhotos: ['photos', 'me'] as const,
  chatMatches: ['chat', 'matches'] as const,
  messages: (matchId: string) => ['chat', 'messages', matchId] as const,
  discoveryFeed: ['discovery', 'feed'] as const,
};
