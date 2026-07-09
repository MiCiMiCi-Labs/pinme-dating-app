import { useQuery } from '@tanstack/react-query';
import { getCurrentAppUser } from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

export function useCurrentUser() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.currentUser(userId) : ['user', 'anonymous', 'current'],
    queryFn: () => getCurrentAppUser(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 60_000,
  });
}
