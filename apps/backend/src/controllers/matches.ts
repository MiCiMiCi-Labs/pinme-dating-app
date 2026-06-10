import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

function calculateAge(birthday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age -= 1;
  }
  return age;
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
    },
  },
};

export async function getMatches(req: Request, res: Response) {
  try {
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
    });

    const result = await Promise.all(matches.map(async (match) => {
      const other = match.user1Id === dbUserId ? match.user2 : match.user1;
      const { birthday, ...otherFields } = other;
      const unreadCount = await prisma.message.count({
        where: {
          matchId: match.id,
          senderId: { not: dbUserId },
          isRead: false,
        },
      });

      return {
        matchId: match.id,
        createdAt: match.createdAt,
        lastMessage: match.messages[0] ?? null,
        unreadCount,
        user: { ...otherFields, age: calculateAge(birthday) },
      };
    }));

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function unmatch(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, user1Id: true, user2Id: true, unmatchedAt: true },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.user1Id !== dbUserId && match.user2Id !== dbUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (match.unmatchedAt) {
      res.status(409).json({ error: 'Already unmatched' });
      return;
    }

    await prisma.match.update({
      where: { id: matchId },
      data: { unmatchedAt: new Date() },
    });

    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
