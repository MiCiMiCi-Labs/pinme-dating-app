import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sanitizePublicProfile } from '../lib/publicProfile';

function calculateAge(birthday: Date): number {
  // Use UTC calendar-date getters throughout — birthday is stored as a UTC
  // date-only value (@db.Date), and this must stay in lockstep with the
  // birthdayFilter boundary logic below, which is also UTC-anchored. Mixing
  // local-timezone getters here with UTC ones there would let a user pass the
  // age filter under one date but be reported with a different age under the
  // other, particularly around local midnight in timezones ahead of UTC
  // (e.g. Pacific/Auckland).
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birthday.getUTCMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthday.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
}

function calculateDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const earthRadiusKm = 6371;
  const latDiff = ((to.latitude - from.latitude) * Math.PI) / 180;
  const lonDiff = ((to.longitude - from.longitude) * Math.PI) / 180;
  const fromLat = (from.latitude * Math.PI) / 180;
  const toLat = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lonDiff / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fuzzyDistance(km: number | null): string | null {
  if (km === null) return null;
  if (km < 5) return '< 5km';
  if (km < 20) return '5–20km';
  if (km < 50) return '20–50km';
  return '> 50km';
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 20);

  if (!Number.isInteger(limit)) {
    return 20;
  }

  return Math.min(Math.max(limit, 1), 50);
}

function parseCursor(raw: string): { createdAt: string; id: string } {
  const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string' ||
    Number.isNaN(new Date((parsed as Record<string, unknown>).createdAt as string).getTime())
  ) {
    throw new Error('invalid cursor');
  }
  return parsed as { createdAt: string; id: string };
}

function encodeCursor(data: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export async function getDiscoveryFeed(req: Request, res: Response) {
  try {
    const limit = parseLimit(req.query.limit);
    const cursorParam =
      typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;

    let cursor: { createdAt: string; id: string } | null = null;
    if (cursorParam) {
      try {
        cursor = parseCursor(cursorParam);
      } catch {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
    }

    const currentUser = await prisma.user.findUnique({
      where: { supabaseAuthId: req.userId! },
      include: {
        preferences: true,
        location: true,
        swipesGiven: { select: { targetId: true } },
        blocksGiven: { select: { blockedId: true } },
        blocksReceived: { select: { blockerId: true } },
      },
    });

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const excludedUserIds = new Set<string>([
      currentUser.id,
      ...currentUser.swipesGiven.map((swipe) => swipe.targetId),
      ...currentUser.blocksGiven.map((block) => block.blockedId),
      ...currentUser.blocksReceived.map((block) => block.blockerId),
    ]);

    const preferences = currentUser.preferences;
    const where: Prisma.UserWhereInput = {
      id: { notIn: Array.from(excludedUserIds) },
      profile: { isNot: null },
      photos: { some: {} },
      OR: [
        { privacySettings: { is: null } },
        { privacySettings: { is: { discoverable: true } } },
      ],
    };

    if (preferences?.preferredGender) {
      where.gender = preferences.preferredGender;
    }

    if (preferences?.minHeight || preferences?.maxHeight) {
      where.profile = {
        is: {
          height: {
            ...(preferences.minHeight ? { gte: preferences.minHeight } : {}),
            ...(preferences.maxHeight ? { lte: preferences.maxHeight } : {}),
          },
        },
      };
    }

    const birthdayFilter: Prisma.DateTimeFilter = {};
    const now = new Date();
    // birthday is stored as a UTC date-only value (@db.Date); anchor "today" and
    // the age boundaries to UTC calendar dates too, so the comparison doesn't
    // shift by a day depending on the server's local timezone (e.g. NZT).
    const todayUTCYear = now.getUTCFullYear();
    const todayUTCMonth = now.getUTCMonth();
    const todayUTCDate = now.getUTCDate();

    if (preferences?.minAge) {
      birthdayFilter.lte = new Date(
        Date.UTC(todayUTCYear - preferences.minAge, todayUTCMonth, todayUTCDate)
      );
    }

    if (preferences?.maxAge) {
      birthdayFilter.gt = new Date(
        Date.UTC(todayUTCYear - preferences.maxAge - 1, todayUTCMonth, todayUTCDate)
      );
    }

    if (Object.keys(birthdayFilter).length > 0) {
      where.birthday = birthdayFilter;
    }

    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      where.AND = [
        {
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: { equals: cursorDate }, id: { lt: cursor.id } },
          ],
        },
      ];
    }

    const bufferSize = limit * 4;
    const candidates = await prisma.user.findMany({
      where,
      include: {
        profile: true,
        photos: {
          orderBy: [{ isPrimary: 'desc' }, { orderIndex: 'asc' }],
        },
        location: true,
        privacySettings: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: bufferSize,
    });

    const scored = candidates.map((candidate) => {
      const age = calculateAge(candidate.birthday);
      const distanceKm =
        currentUser.location && candidate.location
          ? calculateDistanceKm(currentUser.location, candidate.location)
          : null;

      return { candidate, age, distanceKm };
    });

    const passesDistance = ({ distanceKm }: (typeof scored)[number]) =>
      !preferences?.maxDistanceKm || distanceKm === null || distanceKm <= preferences.maxDistanceKm;

    const selected: typeof scored = [];
    let lastConsumedIndex = -1;

    for (let i = 0; i < scored.length; i += 1) {
      if (passesDistance(scored[i])) {
        selected.push(scored[i]);
        lastConsumedIndex = i;
        if (selected.length === limit) break;
      }
    }

    const users = selected.map(({ candidate, age, distanceKm }) => ({
      id: candidate.id,
      name: candidate.name,
      gender: candidate.gender,
      bio: candidate.bio,
      city: candidate.city,
      age,
      distanceKm: candidate.privacySettings?.showDistance
        ? fuzzyDistance(distanceKm)
        : null,
      profile: sanitizePublicProfile(candidate.profile),
      photos: candidate.photos,
    }));

    let nextCursor: string | null = null;

    // If the last candidate we consumed was also the last row of the buffer,
    // and the buffer wasn't full, the database had no more matching rows at
    // all — there's nothing left to resume from, so don't hand back a cursor
    // that would only ever produce an empty page.
    const exhaustedDatabase =
      lastConsumedIndex === candidates.length - 1 && candidates.length < bufferSize;

    if (selected.length === limit && lastConsumedIndex >= 0 && !exhaustedDatabase) {
      // More candidates may remain unconsumed in this buffer (or beyond it) —
      // resume right after the last candidate we actually returned.
      const resumeFrom = candidates[lastConsumedIndex];
      nextCursor = encodeCursor({
        createdAt: resumeFrom.createdAt.toISOString(),
        id: resumeFrom.id,
      });
    } else if (selected.length < limit && candidates.length === bufferSize) {
      // We didn't fill the page, but the buffer was full — there may be more
      // rows past it, so keep scanning from the end of this buffer.
      const lastDbCandidate = candidates[candidates.length - 1];
      nextCursor = encodeCursor({
        createdAt: lastDbCandidate.createdAt.toISOString(),
        id: lastDbCandidate.id,
      });
    }

    res.json({ users, nextCursor });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
