import { useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSwipe, getDiscoveryFeed, type SwipeAction } from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

const DISCOVERY_PAGE_SIZE = 5;

export function useDiscoveryFeed(enabled = true) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useInfiniteQuery({
    queryKey: userId ? queryKeys.discoveryFeed(userId) : ['discovery', 'anonymous', 'feed'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      getDiscoveryFeed(accessToken!, { limit: DISCOVERY_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(accessToken && userId && enabled),
    staleTime: 30_000,
  });
}

export function useResetDiscoveryFeed() {
  const userId = useAuthUserId();
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (!userId) return;
    queryClient.resetQueries({ queryKey: queryKeys.discoveryFeed(userId) });
  }, [userId, queryClient]);
}

export function useCreateSwipe() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetId, action }: { targetId: string; action: SwipeAction }) =>
      createSwipe(accessToken!, targetId, action),
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMatches(userId) });
    },
  });
}
