import { type ChatMessage } from '@/lib/api';

export type LocalChatMessage = ChatMessage & { _status?: 'sending' | 'failed' };
