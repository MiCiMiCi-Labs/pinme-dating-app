import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSwipe, getDiscoveryFeed, type SwipeAction } from '@/lib/api';
import { useAccessToken } from './auth';
import { queryKeys } from './keys';

export function useDiscoveryFeed(enabled = true) {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: queryKeys.discoveryFeed,
    queryFn: () => getDiscoveryFeed(accessToken!),
    enabled: Boolean(accessToken && enabled),
    staleTime: 30_000,
  });
}

export function useCreateSwipe() {
  const accessToken = useAccessToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetId, action }: { targetId: string; action: SwipeAction }) =>
      createSwipe(accessToken!, targetId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMatches });
    },
  });
}
