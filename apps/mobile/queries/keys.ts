export const queryKeys = {
  currentUser: (userId: string) => ['user', userId, 'current'] as const,
  myProfile: (userId: string) => ['profile', userId, 'me'] as const,
  myPhotos: (userId: string) => ['photos', userId, 'me'] as const,
  chatMatches: (userId: string) => ['chat', userId, 'matches'] as const,
  messages: (userId: string, matchId: string) => ['chat', userId, 'messages', matchId] as const,
  discoveryFeed: (userId: string) => ['discovery', userId, 'feed'] as const,
};
