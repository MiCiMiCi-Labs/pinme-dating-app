import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getChatMatches,
  getMessages,
  sendMessage,
} from '@/lib/api';
import { useAccessToken, useAuthUserId } from './auth';
import { queryKeys } from './keys';

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
