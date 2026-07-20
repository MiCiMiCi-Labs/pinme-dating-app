import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteMyAccount,
  getCurrentAppUser,
  getPrivacySettings,
  updatePrivacySettings,
  type PrivacySettingsUpdateInput,
} from '@/lib/api';
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

export function usePrivacySettings() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.privacySettings(userId) : ['privacy', 'anonymous', 'me'],
    queryFn: () => getPrivacySettings(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 60_000,
  });
}

export function useUpdatePrivacySettings() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: PrivacySettingsUpdateInput) => updatePrivacySettings(accessToken!, data),
    onSuccess: (settings) => {
      if (!userId) return;
      queryClient.setQueryData(queryKeys.privacySettings(userId), settings);
    },
  });
}

export function useDeleteAccount() {
  const accessToken = useAccessToken();

  return useMutation({
    mutationFn: () => deleteMyAccount(accessToken!),
  });
}
