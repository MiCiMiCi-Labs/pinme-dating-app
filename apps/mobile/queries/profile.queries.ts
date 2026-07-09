import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyPhotos,
  getMyProfile,
  updateMyProfileData,
  type ProfileUpdateInput,
} from '@/lib/api';
import { useAccessToken } from './auth';
import { queryKeys } from './keys';

export function useMyProfile() {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: queryKeys.myProfile,
    queryFn: () => getMyProfile(accessToken!),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
}

export function useMyPhotos() {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: queryKeys.myPhotos,
    queryFn: () => getMyPhotos(accessToken!),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
}

export function useUpdateMyProfile() {
  const accessToken = useAccessToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ProfileUpdateInput) => updateMyProfileData(accessToken!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
      queryClient.invalidateQueries({ queryKey: queryKeys.myProfile });
    },
  });
}
