import { useQuery } from '@tanstack/react-query';
import { getCurrentAppUser } from '@/lib/api';
import { useAccessToken } from './auth';
import { queryKeys } from './keys';

export function useCurrentUser() {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () => getCurrentAppUser(accessToken!),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
}
