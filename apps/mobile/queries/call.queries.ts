import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCallInvitation,
  getCallPreference,
  updateCallPreference,
  type CallPreferenceState,
} from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

export function useCallPreference(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey:
      userId && matchId ? queryKeys.callPreference(userId, matchId) : ['calls', 'anonymous', 'preference'],
    queryFn: () => getCallPreference(accessToken!, matchId!),
    enabled: Boolean(accessToken && userId && matchId),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}

export function useUpdateCallPreference(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (audioEnabled: boolean) => updateCallPreference(accessToken!, matchId!, audioEnabled),
    onSuccess: (data: CallPreferenceState) => {
      if (userId && matchId) {
        queryClient.setQueryData(queryKeys.callPreference(userId, matchId), data);
      }
    },
  });
}

export function useCreateCallInvitation(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCallInvitation(accessToken!, matchId!),
    onSuccess: data => {
      if (userId && matchId) {
        queryClient.setQueryData(queryKeys.callPreference(userId, matchId), {
          mineEnabled: data.mineEnabled,
          theirsEnabled: data.theirsEnabled,
          mutuallyEnabled: data.mutuallyEnabled,
        });
      }
    },
  });
}
