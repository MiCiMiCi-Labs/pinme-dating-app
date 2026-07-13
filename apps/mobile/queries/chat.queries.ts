import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSwipe,
  getChatMatches,
  getLikesList,
  getLikesPreview,
  getMessages,
  type ChatMatch,
  type ChatMessage,
  type PublicUser,
  sendMessage,
} from '@/lib/api';
import { getDisplayPhotoUrl } from '@/lib/photos';
import { hideLikedUser, restoreLikedUser } from '@/stores/likedYou.store';
import { registerMatchSuccess } from '@/stores/matchEvents.store';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

const defaultMatchIntimacy: ChatMatch['intimacy'] = {
  level: 0,
  label: 'New',
  color: 'white',
  score: 0,
  mutualDays: 0,
  currentStreakDays: 0,
};

export function useChatMatches() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.chatMatches(userId) : ['chat', 'anonymous', 'matches'],
    queryFn: () => getChatMatches(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 30_000,
  });
}

export function useLikesPreview() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.likesPreview(userId) : ['likes', 'anonymous', 'preview'],
    queryFn: () => getLikesPreview(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 60_000,
  });
}

export function useLikesList() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey: userId ? queryKeys.likesList(userId) : ['likes', 'anonymous', 'list'],
    queryFn: () => getLikesList(accessToken!),
    enabled: Boolean(accessToken && userId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useMatchFromLikesList() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targetUser: PublicUser) =>
      createSwipe(accessToken!, targetUser.id, 'LIKE').then(result => ({ result, targetUser })),
    onMutate: async (targetUser) => {
      if (!userId) return undefined;

      hideLikedUser(targetUser.id);

      const likesListKey = queryKeys.likesList(userId);
      const likesPreviewKey = queryKeys.likesPreview(userId);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: likesListKey }),
        queryClient.cancelQueries({ queryKey: likesPreviewKey }),
      ]);

      const previousList = queryClient.getQueryData<{ likedBy: PublicUser[] }>(likesListKey);
      const previousPreview = queryClient.getQueryData<{
        count: number;
        preview: Array<{ userId: string; photoUrl: string; thumbnailUrl: string }>;
      }>(likesPreviewKey);

      queryClient.setQueryData<{ likedBy: PublicUser[] }>(likesListKey, old => ({
        likedBy: (old?.likedBy ?? []).filter(user => user.id !== targetUser.id),
      }));

      queryClient.setQueryData<typeof previousPreview>(likesPreviewKey, old => {
        if (!old) return old;
        return {
          count: Math.max(0, old.count - 1),
          preview: old.preview.filter(item => item.userId !== targetUser.id),
        };
      });

      return { previousList, previousPreview };
    },
    onError: (_error, _targetUser, context) => {
      restoreLikedUser(_targetUser.id);
      if (!userId || !context) return;
      if (context.previousList) {
        queryClient.setQueryData(queryKeys.likesList(userId), context.previousList);
      }
      if (context.previousPreview) {
        queryClient.setQueryData(queryKeys.likesPreview(userId), context.previousPreview);
      }
    },
    onSuccess: ({ result, targetUser }) => {
      if (!userId) return;

      if (result.match) {
        const match = result.match;
        const primaryPhoto = targetUser.photos.find(photo => photo.isPrimary) ?? targetUser.photos[0];
        registerMatchSuccess({
          matchId: match.id,
          userId: targetUser.id,
          userName: targetUser.name,
          photoUrl: primaryPhoto ? getDisplayPhotoUrl(primaryPhoto, 'thumbnail') : undefined,
        });

        queryClient.setQueryData<ChatMatch[]>(queryKeys.chatMatches(userId), old => {
          const previous = old ?? [];
          if (previous.some(item => item.matchId === match.id)) return previous;

          const createdAt = match.createdAt ?? new Date().toISOString();
          const lastMessage = result.message
            ? ({
                ...result.message,
                createdAt: result.message.createdAt ?? createdAt,
                reactions: result.message.reactions ?? [],
                replyTo: result.message.replyTo ?? null,
              } as ChatMessage)
            : null;

          return [
            {
              matchId: match.id,
              createdAt,
              lastMessage,
              unreadCount: 0,
              intimacy: defaultMatchIntimacy,
              user: {
                id: targetUser.id,
                name: targetUser.name,
                age: targetUser.age,
                gender: targetUser.gender,
                bio: targetUser.bio,
                city: targetUser.city,
                profile: targetUser.profile,
                photos: targetUser.photos,
              },
            },
            ...previous,
          ];
        });
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.likesPreview(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.likesList(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMatches(userId) });
    },
  });
}

export function useMessages(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();

  return useQuery({
    queryKey:
      userId && matchId
        ? queryKeys.messages(userId, matchId)
        : ['chat', userId ?? 'anonymous', 'messages', 'missing'],
    queryFn: () => getMessages(accessToken!, matchId!),
    enabled: Boolean(accessToken && userId && matchId),
    staleTime: 10_000,
  });
}

export function useSendTextMessage(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ content, replyToId }: { content: string; replyToId?: string }) =>
      sendMessage(accessToken!, matchId!, content, replyToId),
    onSuccess: () => {
      if (!userId) return;
      if (matchId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(userId, matchId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMatches(userId) });
    },
  });
}
