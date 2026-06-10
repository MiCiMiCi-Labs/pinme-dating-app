import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

function calculateAge(birthday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthday.getDate())
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

export async function getDiscoveryFeed(req: Request, res: Response) {
  try {
    const limit = parseLimit(req.query.limit);

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
      orderBy: { createdAt: 'desc' },
      take: limit * 3,
    });

    const users = candidates
      .map((candidate) => {
        const age = calculateAge(candidate.birthday);
        const distanceKm =
          currentUser.location && candidate.location
            ? calculateDistanceKm(currentUser.location, candidate.location)
            : null;

        return {
          candidate,
          age,
          distanceKm,
        };
      })
      .filter(({ age, distanceKm }) => {
        const matchesMinAge = !preferences?.minAge || age >= preferences.minAge;
        const matchesMaxAge = !preferences?.maxAge || age <= preferences.maxAge;
        const matchesDistance =
          !preferences?.maxDistanceKm ||
          (distanceKm !== null && distanceKm <= preferences.maxDistanceKm);

        return matchesMinAge && matchesMaxAge && matchesDistance;
      })
      .slice(0, limit)
      .map(({ candidate, age, distanceKm }) => ({
        id: candidate.id,
        name: candidate.name,
        gender: candidate.gender,
        bio: candidate.bio,
        city: candidate.city,
        age,
        distanceKm: candidate.privacySettings?.showDistance
          ? fuzzyDistance(distanceKm)
          : null,
        profile: candidate.profile,
        photos: candidate.photos,
      }));

    res.json({ users });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
