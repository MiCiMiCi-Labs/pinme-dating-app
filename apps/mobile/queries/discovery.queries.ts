import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSwipe, getDiscoveryFeed, type SwipeAction } from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

export function useDiscoveryFeed(enabled = true) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.discoveryFeed(userId) : ['discovery', 'anonymous', 'feed'],
    queryFn: () => getDiscoveryFeed(accessToken!),
    enabled: Boolean(accessToken && userId && enabled),
    staleTime: 30_000,
  });
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
