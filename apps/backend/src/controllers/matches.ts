import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';
import { endActiveCallsForPair } from '../lib/calls';
import { sanitizePublicProfile } from '../lib/publicProfile';
import { getBlockBetween } from '../lib/safety';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 20);

  if (!Number.isInteger(limit)) {
    return 20;
  }

  return Math.min(Math.max(limit, 1), 50);
}

type MatchListRow = {
  match_id: string;
  match_created_at: Date;
  user_id: string;
  name: string;
  gender: string;
  birthday: Date;
  city: string | null;
  photo_id: string | null;
  photo_url: string | null;
  photo_thumbnail_url: string | null;
  photo_is_primary: boolean | null;
  photo_is_verified: boolean | null;
  photo_order_index: number | null;
};

const matchedProfileUserSelect = {
  id: true,
  name: true,
  gender: true,
  birthday: true,
  bio: true,
  city: true,
  profile: true,
  photos: {
    orderBy: [{ isPrimary: 'desc' as const }, { orderIndex: 'asc' as const }],
  },
};

function serializeMatchedProfile(user: {
  id: string;
  name: string;
  gender: string;
  birthday: Date;
  bio: string | null;
  city: string | null;
  profile: Parameters<typeof sanitizePublicProfile>[0];
  photos: unknown;
}) {
  const { birthday, profile, ...rest } = user;
  return {
    ...rest,
    profile: sanitizePublicProfile(profile),
    age: calculateAge(birthday),
  };
}

export async function getMatches(req: Request, res: Response) {
  try {
    const limit = parseLimit(req.query.limit);
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const rows = await prisma.$queryRaw<MatchListRow[]>`
      SELECT
        m.id AS match_id,
        m.created_at AS match_created_at,
        other_user.id AS user_id,
        other_user.name,
        other_user.gender::text AS gender,
        other_user.birthday,
        other_user.city,
        primary_photo.id AS photo_id,
        primary_photo.url AS photo_url,
        primary_photo.thumbnail_url AS photo_thumbnail_url,
        primary_photo.is_primary AS photo_is_primary,
        primary_photo.is_verified AS photo_is_verified,
        primary_photo.order_index AS photo_order_index
      FROM matches m
      JOIN users other_user
        ON other_user.id = CASE
          WHEN m.user1_id = ${dbUserId} THEN m.user2_id
          ELSE m.user1_id
        END
      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.url,
          p.thumbnail_url,
          p.is_primary,
          p.is_verified,
          p.order_index
        FROM photos p
        WHERE p.user_id = other_user.id
        ORDER BY p.is_primary DESC, p.order_index ASC, p.created_at ASC
        LIMIT 1
      ) primary_photo ON true
      WHERE m.unmatched_at IS NULL
        AND (m.user1_id = ${dbUserId} OR m.user2_id = ${dbUserId})
      ORDER BY m.created_at DESC
      LIMIT ${limit};
    `;

    const result = rows.map((row) => ({
      matchId: row.match_id,
      createdAt: row.match_created_at,
      user: {
        id: row.user_id,
        name: row.name,
        gender: row.gender,
        bio: null,
        city: row.city,
        age: calculateAge(row.birthday),
        profile: null,
        photos: row.photo_id
          ? [{
              id: row.photo_id,
              url: row.photo_url,
              thumbnailUrl: row.photo_thumbnail_url,
              isPrimary: row.photo_is_primary ?? false,
              isVerified: row.photo_is_verified ?? false,
              orderIndex: row.photo_order_index ?? 0,
            }]
          : [],
      },
    }));

    res.json(result);
  } catch (error) {
    console.error('[getMatches] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getMatchProfile(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const dbUserId = await resolveDbUserId(req.userId!);

    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        user1Id: true,
        user2Id: true,
        unmatchedAt: true,
        user1: { select: matchedProfileUserSelect },
        user2: { select: matchedProfileUserSelect },
      },
    });

    if (!match || match.unmatchedAt) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.user1Id !== dbUserId && match.user2Id !== dbUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const otherUserId = match.user1Id === dbUserId ? match.user2Id : match.user1Id;
    const block = await getBlockBetween(dbUserId, otherUserId);
    if (block) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const user = match.user1Id === dbUserId ? match.user2 : match.user1;
    res.json({ user: serializeMatchedProfile(user) });
  } catch (error) {
    console.error('[getMatchProfile] error:', error);
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

    const otherUserId = match.user1Id === dbUserId ? match.user2Id : match.user1Id;
    await endActiveCallsForPair(dbUserId, otherUserId);

    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
