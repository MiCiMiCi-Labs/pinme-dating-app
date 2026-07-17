import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMySubscription, redeemPromoCode } from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

export function useMySubscription(enabled = true) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.subscription(userId) : ['subscription', 'anonymous', 'me'],
    queryFn: () => getMySubscription(accessToken!),
    enabled: Boolean(accessToken && userId && enabled),
    staleTime: 5 * 60_000,
  });
}

export function useRedeemPromoCode() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => redeemPromoCode(accessToken!, code),
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.subscription(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.likesPreview(userId) });
    },
  });
}
