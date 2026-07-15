import { MessageType } from '@prisma/client';
import { prisma } from './prisma';

type PushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data?: Record<string, string>;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isExpoPushToken(token: string) {
  return /^Expo(nent)?PushToken\[[\w-]+\]$/.test(token);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function sendExpoPushMessages(messages: PushMessage[]) {
  const validMessages = messages.filter(message => isExpoPushToken(message.to));
  if (!validMessages.length) return;

  for (const batch of chunk(validMessages, 100)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[notifications] Expo push failed:', response.status, text);
      }
    } catch (error) {
      console.warn('[notifications] Expo push request failed:', error);
    }
  }
}

async function getActiveTokens(userIds: string[]) {
  if (!userIds.length) return [];

  return prisma.pushToken.findMany({
    where: {
      userId: { in: userIds },
      isActive: true,
    },
    select: {
      userId: true,
      token: true,
    },
  });
}

export async function notifyMatchCreated(match: { id: string; user1Id: string; user2Id: string }) {
  const users = await prisma.user.findMany({
    where: { id: { in: [match.user1Id, match.user2Id] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map(user => [user.id, user.name]));
  const tokens = await getActiveTokens([match.user1Id, match.user2Id]);

  await sendExpoPushMessages(tokens.map(({ userId, token }) => {
    const otherUserId = userId === match.user1Id ? match.user2Id : match.user1Id;
    const otherName = nameById.get(otherUserId) ?? 'Someone';

    return {
      to: token,
      sound: 'default',
      title: "It's a match!",
      body: `You and ${otherName} matched. Say hello.`,
      data: {
        type: 'match',
        matchId: match.id,
        userId: otherUserId,
      },
    };
  }));
}

function previewMessage(messageType: MessageType, content: string) {
  switch (messageType) {
    case MessageType.IMAGE:
      return 'Sent you a photo';
    case MessageType.VOICE:
      return 'Sent you a voice message';
    case MessageType.VIDEO:
      return 'Sent you a video';
    case MessageType.GIF:
      return 'Sent you a GIF';
    default:
      return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  }
}

export async function notifyMessageReceived(params: {
  matchId: string;
  senderId: string;
  recipientId: string;
  messageId: string;
  messageType: MessageType;
  content: string;
}) {
  const [sender, tokens] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.senderId },
      select: { name: true },
    }),
    getActiveTokens([params.recipientId]),
  ]);

  const title = sender?.name ?? 'New message';
  const body = previewMessage(params.messageType, params.content);

  await sendExpoPushMessages(tokens.map(({ token }) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: {
      type: 'message',
      matchId: params.matchId,
      messageId: params.messageId,
      senderId: params.senderId,
    },
  })));
}
