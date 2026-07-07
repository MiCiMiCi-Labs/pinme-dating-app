import { MessageType } from '@prisma/client';
import { prisma } from './prisma';

type IntimacyMessage = {
  senderId: string | null;
  messageType: MessageType;
  recalledAt: Date | null;
  createdAt: Date;
};

export type ChatIntimacy = {
  level: 0 | 1 | 2 | 3 | 4;
  label: 'New' | 'Warming up' | 'Steady' | 'Close' | 'Deep';
  color: 'white' | 'yellow' | 'pink' | 'red' | 'purple';
  score: number;
  mutualDays: number;
  currentStreakDays: number;
};

const LEVELS: Array<Omit<ChatIntimacy, 'score' | 'mutualDays' | 'currentStreakDays'>> = [
  { level: 0, label: 'New', color: 'white' },
  { level: 1, label: 'Warming up', color: 'yellow' },
  { level: 2, label: 'Steady', color: 'pink' },
  { level: 3, label: 'Close', color: 'red' },
  { level: 4, label: 'Deep', color: 'purple' },
];

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getLevel(score: number) {
  if (score >= 100) return LEVELS[4];
  if (score >= 70) return LEVELS[3];
  if (score >= 40) return LEVELS[2];
  if (score >= 20) return LEVELS[1];
  return LEVELS[0];
}

export function calculateChatIntimacy(
  messages: IntimacyMessage[],
  user1Id: string,
  user2Id: string
): ChatIntimacy {
  const chatMessages = messages
    .filter(message =>
      message.senderId &&
      message.recalledAt === null &&
      message.messageType !== MessageType.SYSTEM
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const senderCounts = new Map<string, number>();
  const activeDays = new Map<string, Set<string>>();
  const recentCutoff = addDays(new Date(), -7);
  let recentMessages = 0;
  let alternatingTurns = 0;
  let previousSenderId: string | null = null;

  for (const message of chatMessages) {
    const senderId = message.senderId!;
    senderCounts.set(senderId, (senderCounts.get(senderId) ?? 0) + 1);

    const dayKey = toDayKey(message.createdAt);
    const daySenders = activeDays.get(dayKey) ?? new Set<string>();
    daySenders.add(senderId);
    activeDays.set(dayKey, daySenders);

    if (message.createdAt >= recentCutoff) {
      recentMessages++;
      if (previousSenderId && previousSenderId !== senderId) {
        alternatingTurns++;
      }
    }
    previousSenderId = senderId;
  }

  const user1Count = senderCounts.get(user1Id) ?? 0;
  const user2Count = senderCounts.get(user2Id) ?? 0;
  const maxCount = Math.max(user1Count, user2Count);
  const minCount = Math.min(user1Count, user2Count);
  const balanceRatio = maxCount > 0 ? minCount / maxCount : 0;

  const mutualDayKeys = Array.from(activeDays.entries())
    .filter(([, senders]) => senders.has(user1Id) && senders.has(user2Id))
    .map(([day]) => day)
    .sort();

  const mutualDays = mutualDayKeys.length;
  const mutualDaySet = new Set(mutualDayKeys);
  const streakAnchor = mutualDayKeys.at(-1);
  let currentStreakDays = 0;

  if (streakAnchor) {
    let cursor = new Date(`${streakAnchor}T00:00:00.000Z`);
    while (mutualDaySet.has(toDayKey(cursor))) {
      currentStreakDays++;
      cursor = addDays(cursor, -1);
    }
  }

  const score = Math.round(
    Math.min(mutualDays * 6, 30) +
    Math.min(currentStreakDays * 8, 32) +
    Math.min(recentMessages * 1.5, 24) +
    Math.min(alternatingTurns * 2, 14) +
    Math.round(balanceRatio * 20)
  );

  const level = getLevel(score);

  return {
    ...level,
    score,
    mutualDays,
    currentStreakDays,
  };
}

export async function getMatchIntimacy(matchId: string, user1Id: string, user2Id: string) {
  const messages = await prisma.message.findMany({
    where: { matchId },
    select: {
      senderId: true,
      messageType: true,
      recalledAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return calculateChatIntimacy(messages, user1Id, user2Id);
}
