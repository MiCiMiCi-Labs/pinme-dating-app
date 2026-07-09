import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getChatMatches,
  getMessages,
  sendMessage,
} from '@/lib/api';
import { useAccessToken } from './auth';
import { queryKeys } from './keys';

export function useChatMatches() {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: queryKeys.chatMatches,
    queryFn: () => getChatMatches(accessToken!),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });
}

export function useMessages(matchId: string | null | undefined) {
  const accessToken = useAccessToken();

  return useQuery({
    queryKey: matchId ? queryKeys.messages(matchId) : ['chat', 'messages', 'missing'],
    queryFn: () => getMessages(accessToken!, matchId!),
    enabled: Boolean(accessToken && matchId),
    staleTime: 10_000,
  });
}

export function useSendTextMessage(matchId: string | null | undefined) {
  const accessToken = useAccessToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ content, replyToId }: { content: string; replyToId?: string }) =>
      sendMessage(accessToken!, matchId!, content, replyToId),
    onSuccess: () => {
      if (matchId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(matchId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.chatMatches });
    },
  });
}
