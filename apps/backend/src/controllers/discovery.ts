import { Gender, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';

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

function createTimingLogger(label: string, thresholdMs = 1000) {
  const start = Date.now();
  let previous = start;
  const marks: Array<{ label: string; totalMs: number; stepMs: number }> = [];

  return {
    mark(stepLabel: string) {
      const now = Date.now();
      marks.push({
        label: stepLabel,
        totalMs: now - start,
        stepMs: now - previous,
      });
      previous = now;
    },
    flush(extra?: Record<string, unknown>) {
      const totalMs = Date.now() - start;
      if (totalMs < thresholdMs) return;

      console.warn(`[timing] ${label} total=${totalMs}ms`, {
        ...extra,
        steps: marks,
      });
    },
  };
}

type DiscoveryContextRow = {
  id: string;
  preferredGender: Gender | null;
  minAge: number | null;
  maxAge: number | null;
  maxDistanceKm: number | null;
  minHeight: number | null;
  maxHeight: number | null;
  latitude: number | null;
  longitude: number | null;
  excludedUserIds: string[];
};

export async function getDiscoveryFeed(req: Request, res: Response) {
  const timing = createTimingLogger('GET /api/v1/discovery');

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
    timing.mark('parse query');

    const [currentUser] = await prisma.$queryRaw<DiscoveryContextRow[]>`
      SELECT
        u.id::text AS id,
        p.preferred_gender AS "preferredGender",
        p.min_age AS "minAge",
        p.max_age AS "maxAge",
        p.max_distance_km AS "maxDistanceKm",
        p.min_height AS "minHeight",
        p.max_height AS "maxHeight",
        l.latitude,
        l.longitude,
        (
          COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.target_id::text), NULL), ARRAY[]::text[]) ||
          COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT bg.blocked_id::text), NULL), ARRAY[]::text[]) ||
          COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT br.blocker_id::text), NULL), ARRAY[]::text[])
        ) AS "excludedUserIds"
      FROM users u
      LEFT JOIN preferences p ON p.user_id = u.id
      LEFT JOIN locations l ON l.user_id = u.id
      LEFT JOIN swipes s ON s.swiper_id = u.id
      LEFT JOIN blocks bg ON bg.blocker_id = u.id
      LEFT JOIN blocks br ON br.blocked_id = u.id
      WHERE u."supabaseAuthId" = ${req.userId!}
      GROUP BY
        u.id,
        p.preferred_gender,
        p.min_age,
        p.max_age,
        p.max_distance_km,
        p.min_height,
        p.max_height,
        l.latitude,
        l.longitude
      LIMIT 1
    `;
    timing.mark('load current user context');

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const preferences = {
      preferredGender: currentUser.preferredGender,
      minAge: currentUser.minAge,
      maxAge: currentUser.maxAge,
      maxDistanceKm: currentUser.maxDistanceKm,
      minHeight: currentUser.minHeight,
      maxHeight: currentUser.maxHeight,
    };
    const currentLocation =
      currentUser.latitude != null && currentUser.longitude != null
        ? { latitude: currentUser.latitude, longitude: currentUser.longitude }
        : null;

    const excludedUserIds = new Set<string>([
      currentUser.id,
      ...(currentUser.excludedUserIds ?? []),
    ]);

    const where: Prisma.UserWhereInput = {
      id: { notIn: Array.from(excludedUserIds) },
      profile: { isNot: null },
      photos: { some: {} },
      // Every user gets a privacySettings row the moment their account is
      // created (see syncCurrentUser). Treating a missing row as
      // discoverable was a privacy fail-open: if that row were ever lost
      // to a migration bug or bad data import, someone who'd explicitly
      // turned discoverability off would silently reappear.
      privacySettings: { is: { discoverable: true } },
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
    timing.mark('build filters');

    const bufferSize = Math.min(limit * 2, 20);
    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        gender: true,
        birthday: true,
        city: true,
        createdAt: true,
        profile: {
          select: {
            jobTitle: true,
            relationshipGoal: true,
            height: true,
            hiddenFields: true,
          },
        },
        photos: {
          select: {
            id: true,
            url: true,
            thumbnailUrl: true,
            isPrimary: true,
            isVerified: true,
            orderIndex: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { orderIndex: 'asc' }],
        },
        location: true,
        privacySettings: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: bufferSize,
    });
    timing.mark('load candidates');

    const scored = candidates.map((candidate) => {
      const age = calculateAge(candidate.birthday);
      const distanceKm =
        currentLocation && candidate.location
          ? calculateDistanceKm(currentLocation, candidate.location)
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
    timing.mark('score and filter');

    const users = selected.map(({ candidate, age, distanceKm }) => ({
      id: candidate.id,
      name: candidate.name,
      gender: candidate.gender,
      city: candidate.city,
      age,
      distanceKm: candidate.privacySettings?.showDistance
        ? fuzzyDistance(distanceKm)
        : null,
      jobTitle: candidate.profile?.hiddenFields?.includes('jobTitle')
        ? null
        : candidate.profile?.jobTitle ?? null,
      relationshipGoal: candidate.profile?.relationshipGoal ?? null,
      height: candidate.profile?.height ?? null,
      primaryPhoto: candidate.photos[0] ?? null,
      photos: candidate.photos,
      photoCount: candidate.photos.length,
    }));
    timing.mark('map response');

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
    timing.mark('build cursor');
    timing.flush({
      limit,
      cursor: Boolean(cursor),
      excludedCount: excludedUserIds.size,
      candidateCount: candidates.length,
      selectedCount: selected.length,
      nextCursor: Boolean(nextCursor),
    });

    res.json({ users, nextCursor });
  } catch (error) {
    console.error('[getDiscoveryFeed] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
