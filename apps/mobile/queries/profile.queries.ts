import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyPhotos,
  getMyProfile,
  updateMyProfileData,
  type ProfileUpdateInput,
} from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

export function useMyProfile() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.myProfile(userId) : ['profile', 'anonymous', 'me'],
    queryFn: () => getMyProfile(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 60_000,
  });
}

export function useMyPhotos() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.myPhotos(userId) : ['photos', 'anonymous', 'me'],
    queryFn: () => getMyPhotos(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 60_000,
  });
}

export function useUpdateMyProfile() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProfileUpdateInput) => updateMyProfileData(accessToken!, data),
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.myProfile(userId) });
    },
  });
}
