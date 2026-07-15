import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
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

export async function getMatches(req: Request, res: Response) {
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
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const result = matches.map((match) => {
      const other = match.user1Id === dbUserId ? match.user2 : match.user1;
      const { birthday, ...otherFields } = other;

      return {
        matchId: match.id,
        createdAt: match.createdAt,
        user: { ...otherFields, age: calculateAge(birthday) },
      };
    });

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
