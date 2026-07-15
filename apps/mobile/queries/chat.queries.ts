import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
import { markSwiped } from '@/lib/swipedUsers';
import { hideLikedUser, restoreLikedUser } from '@/stores/likedYou.store';
import { registerMatchSuccess } from '@/stores/matchEvents.store';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

type LikesListData = { likedBy: PublicUser[] };
type LikesPreviewData = {
  count: number;
  preview: Array<{ userId: string; photoUrl: string; thumbnailUrl: string }>;
};
type LikesCachesSnapshot = {
  previousList?: LikesListData;
  previousPreview?: LikesPreviewData;
};

// Shared cache helpers for the "act on someone in the Likes You list" flows
// (like and dislike). Keeping this in one place means both mutations stay in
// lockstep instead of drifting apart as two hand-copied cache-editing paths.
function snapshotLikesCaches(queryClient: QueryClient, userId: string): LikesCachesSnapshot {
  return {
    previousList: queryClient.getQueryData<LikesListData>(queryKeys.likesList(userId)),
    previousPreview: queryClient.getQueryData<LikesPreviewData>(queryKeys.likesPreview(userId)),
  };
}

function removeUserFromLikesCaches(queryClient: QueryClient, userId: string, targetUserId: string) {
  queryClient.setQueryData<LikesListData>(queryKeys.likesList(userId), old => ({
    likedBy: (old?.likedBy ?? []).filter(user => user.id !== targetUserId),
  }));

  queryClient.setQueryData<LikesPreviewData>(queryKeys.likesPreview(userId), old => {
    if (!old) return old;
    return {
      count: Math.max(0, old.count - 1),
      preview: old.preview.filter(item => item.userId !== targetUserId),
    };
  });
}

function restoreLikesCaches(queryClient: QueryClient, userId: string, snapshot: LikesCachesSnapshot) {
  if (snapshot.previousList) {
    queryClient.setQueryData(queryKeys.likesList(userId), snapshot.previousList);
  }
  if (snapshot.previousPreview) {
    queryClient.setQueryData(queryKeys.likesPreview(userId), snapshot.previousPreview);
  }
}

async function cancelLikesCacheQueries(queryClient: QueryClient, userId: string) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.likesList(userId) }),
    queryClient.cancelQueries({ queryKey: queryKeys.likesPreview(userId) }),
  ]);
}

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

      markSwiped(targetUser.id);
      hideLikedUser(targetUser.id);

      await cancelLikesCacheQueries(queryClient, userId);
      const snapshot = snapshotLikesCaches(queryClient, userId);
      removeUserFromLikesCaches(queryClient, userId, targetUser.id);

      return snapshot;
    },
    onError: (_error, targetUser, context) => {
      restoreLikedUser(targetUser.id);
      if (!userId || !context) return;
      restoreLikesCaches(queryClient, userId, context);
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

// Dismissing someone from the Likes You list. Mirrors useMatchFromLikesList's
// optimistic-update/rollback shape via the shared cache helpers above, but
// never results in a match, so there's no matches-cache or match-overlay work.
export function useDislikeFromLikesList() {
  const accessToken = useAccessToken();
  const userId = useAuthUserId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targetUser: PublicUser) =>
      createSwipe(accessToken!, targetUser.id, 'DISLIKE').then(() => ({ targetUser })),
    onMutate: async (targetUser) => {
      if (!userId) return undefined;

      markSwiped(targetUser.id);
      hideLikedUser(targetUser.id);

      await cancelLikesCacheQueries(queryClient, userId);
      const snapshot = snapshotLikesCaches(queryClient, userId);
      removeUserFromLikesCaches(queryClient, userId, targetUser.id);

      return snapshot;
    },
    onError: (_error, targetUser, context) => {
      restoreLikedUser(targetUser.id);
      if (!userId || !context) return;
      restoreLikesCaches(queryClient, userId, context);
    },
    onSuccess: () => {
      if (!userId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.likesPreview(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.likesList(userId) });
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
