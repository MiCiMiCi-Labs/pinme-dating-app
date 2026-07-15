import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { calculateChatIntimacy } from '../lib/intimacy';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

const otherUserInclude = {
  select: {
    id: true,
    name: true,
    gender: true,
    birthday: true,
    bio: true,
    city: true,
    profile: true,
    photos: {
      orderBy: { orderIndex: 'asc' as const },
      take: 1,
      select: {
        id: true,
        url: true,
        thumbnailUrl: true,
        isPrimary: true,
        isVerified: true,
        orderIndex: true,
      },
    },
  },
};

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 50);

  if (!Number.isInteger(limit)) {
    return 50;
  }

  return Math.min(Math.max(limit, 1), 100);
}

export async function getChats(req: Request, res: Response) {
  try {
    const limit = parseLimit(req.query.limit);
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const matches = await prisma.match.findMany({
      where: {
        OR: [{ user1Id: dbUserId }, { user2Id: dbUserId }],
        unmatchedAt: null,
      },
      include: {
        user1: otherUserInclude,
        user2: otherUserInclude,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const matchIds = matches.map(match => match.id);

    const [unreadCounts, intimacyMessages] = matchIds.length
      ? await Promise.all([
          prisma.message.groupBy({
            by: ['matchId'],
            where: {
              matchId: { in: matchIds },
              senderId: { not: dbUserId },
              isRead: false,
            },
            _count: { _all: true },
          }),
          prisma.message.findMany({
            where: {
              matchId: { in: matchIds },
            },
            select: {
              matchId: true,
              senderId: true,
              messageType: true,
              recalledAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(matchIds.length * 20, 100), 500),
          }),
        ])
      : [[], []];

    const unreadCountByMatchId = new Map(
      unreadCounts.map(count => [count.matchId, count._count._all])
    );

    const intimacyMessagesByMatchId = new Map<string, typeof intimacyMessages>();
    for (const message of intimacyMessages) {
      const messagesForMatch = intimacyMessagesByMatchId.get(message.matchId) ?? [];
      if (messagesForMatch.length < 200) {
        messagesForMatch.push(message);
        intimacyMessagesByMatchId.set(message.matchId, messagesForMatch);
      }
    }

    const result = matches.map((match) => {
      const other = match.user1Id === dbUserId ? match.user2 : match.user1;
      const { birthday, ...otherFields } = other;
      const unreadCount = unreadCountByMatchId.get(match.id) ?? 0;
      const intimacy = calculateChatIntimacy(
        intimacyMessagesByMatchId.get(match.id) ?? [],
        match.user1Id,
        match.user2Id
      );

      return {
        matchId: match.id,
        createdAt: match.createdAt,
        lastMessage: match.messages[0] ?? null,
        unreadCount,
        intimacy,
        user: { ...otherFields, age: calculateAge(birthday) },
      };
    });

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
