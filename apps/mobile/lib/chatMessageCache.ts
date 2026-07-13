import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatIntimacy, ChatMessage } from '@/lib/api';

const CHAT_CACHE_VERSION = 1;
const MAX_CACHED_MESSAGES = 80;

type CachedThread = {
  version: number;
  cachedAt: string;
  messages: ChatMessage[];
  intimacy: ChatIntimacy | null;
};

function getThreadCacheKey(userId: string, matchId: string) {
  return `pinme.chatThread.v${CHAT_CACHE_VERSION}.${userId}.${matchId}`;
}

export async function readCachedThread(userId: string, matchId: string) {
  try {
    const raw = await AsyncStorage.getItem(getThreadCacheKey(userId, matchId));
    if (!raw) return null;

    const cached = JSON.parse(raw) as CachedThread;
    if (cached.version !== CHAT_CACHE_VERSION || !Array.isArray(cached.messages)) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

export async function writeCachedThread(
  userId: string,
  matchId: string,
  messages: ChatMessage[],
  intimacy: ChatIntimacy | null
) {
  const serverMessages = messages.filter(message => !message.id.startsWith('pending-'));
  const cached: CachedThread = {
    version: CHAT_CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    messages: serverMessages.slice(-MAX_CACHED_MESSAGES),
    intimacy,
  };

  try {
    await AsyncStorage.setItem(getThreadCacheKey(userId, matchId), JSON.stringify(cached));
  } catch {
    // Cache failures should never block chat.
  }
}

export async function clearCachedThread(userId: string, matchId: string) {
  try {
    await AsyncStorage.removeItem(getThreadCacheKey(userId, matchId));
  } catch {
    // Ignore cache cleanup failures.
  }
}
