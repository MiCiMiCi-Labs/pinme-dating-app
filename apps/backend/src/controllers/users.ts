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
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id || !UUID_SHAPE.test(id)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const currentUser = await prisma.user.findUnique({
      where: { supabaseAuthId: req.userId! },
      select: { id: true },
    });

    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Viewing your own profile is always allowed and skips every other check.
    if (currentUser.id === id) {
      const self = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
      if (!self) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ user: serializePublicUser(self) });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        ...publicUserSelect,
        privacySettings: { select: { discoverable: true } },
      },
    });

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Block takes priority over everything else, including an existing match.
    if (await hasBlockBetween(currentUser.id, id)) {
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

      if (!activeMatch) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
    }

    const { privacySettings: _privacySettings, ...publicTarget } = target;
    res.json({ user: serializePublicUser(publicTarget) });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
