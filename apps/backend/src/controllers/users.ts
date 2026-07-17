import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';
import { sanitizePublicProfile } from '../lib/publicProfile';
import { hasBlockBetween } from '../lib/safety';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicUserSelect = {
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

function serializePublicUser(user: {
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

export async function getUserById(req: Request, res: Response) {
  try {
    const startedAt = performance.now();
    const timings: Array<{ label: string; totalMs: number; stepMs: number }> = [];
    let lastMark = startedAt;
    const mark = (label: string) => {
      if (!process.env.LOG_DISCOVERY_TIMING && process.env.NODE_ENV === 'production') return;
      const now = performance.now();
      timings.push({
        label,
        totalMs: Math.round(now - startedAt),
        stepMs: Math.round(now - lastMark),
      });
      lastMark = now;
    };

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id || !UUID_SHAPE.test(id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    mark('parse id');

    const [currentUser, target] = await Promise.all([
      prisma.user.findUnique({
        where: { supabaseAuthId: req.userId! },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id },
        select: {
          ...publicUserSelect,
          privacySettings: { select: { discoverable: true } },
        },
      }),
    ]);
    mark('load current and target');

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Viewing your own profile is always allowed and skips every other check.
    if (currentUser.id === id) {
      mark('self allowed');
      const { privacySettings: _privacySettings, ...self } = target;
      console.log(`[timing] GET /api/v1/users/${id} total=${Math.round(performance.now() - startedAt)}ms`, { self: true, steps: timings });
      res.json({ user: serializePublicUser(self) });
      return;
    }

    // Block takes priority over everything else, including an existing match.
    const isBlocked = await hasBlockBetween(currentUser.id, id);
    mark('check block');
    if (isBlocked) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isDiscoverable = target.privacySettings?.discoverable ?? true;

    if (!isDiscoverable) {
      const activeMatch = await prisma.match.findFirst({
        where: {
          unmatchedAt: null,
          OR: [
            { user1Id: currentUser.id, user2Id: id },
            { user1Id: id, user2Id: currentUser.id },
          ],
        },
        select: { id: true },
      });
      mark('check match for private target');

      if (!activeMatch) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
    }

    const { privacySettings: _privacySettings, ...publicTarget } = target;
    console.log(`[timing] GET /api/v1/users/${id} total=${Math.round(performance.now() - startedAt)}ms`, { self: false, isDiscoverable, steps: timings });
    res.json({ user: serializePublicUser(publicTarget) });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
