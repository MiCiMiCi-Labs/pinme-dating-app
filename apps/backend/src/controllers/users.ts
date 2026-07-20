import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';
import { sanitizePublicProfile } from '../lib/publicProfile';
import { hasBlockBetween } from '../lib/safety';
import { supabase } from '../lib/supabase';
import { BUCKET } from '../lib/storage';
import { getStoragePath } from './photos';

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

// Called periodically by the app while in the foreground (see
// apps/mobile — the heartbeat hook mounted at the root layout) to drive the
// "online" indicator on the Messages screen's Activities row. A bare
// timestamp bump, not a full profile write.
export async function heartbeat(req: Request, res: Response) {
  try {
    await prisma.user.update({
      where: { supabaseAuthId: req.userId! },
      data: { lastActiveAt: new Date() },
    });
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Permanently deletes the caller's account. schema.prisma's onDelete: Cascade
// on every User relation (profile, photos, matches, messages sender ->
// SetNull, swipes, blocks, reports, calls, voice rooms, subscription, push
// tokens, etc. — see the model definitions) means a single prisma.user.delete
// removes essentially everything at the database level; this function only
// has to additionally clean up the two things Prisma cascade can't reach:
// the actual Supabase Storage photo files, and the Supabase Auth identity
// itself (a separate system from our `users` table, keyed by
// supabaseAuthId). The DB delete runs FIRST and is the only step whose
// failure aborts the request — a photo-storage or auth-identity cleanup
// failure is logged and swallowed rather than leaving the account
// half-deleted, since by that point the primary goal (the account and its
// data are gone) has already been achieved.
export async function deleteAccount(req: Request, res: Response) {
  try {
    const dbUser = await prisma.user.findUnique({
      where: { supabaseAuthId: req.userId! },
      select: { id: true, supabaseAuthId: true },
    });
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const photos = await prisma.photo.findMany({
      where: { userId: dbUser.id },
      select: { url: true, thumbnailUrl: true },
    });

    await prisma.user.delete({ where: { id: dbUser.id } });

    const storagePaths = photos
      .flatMap(photo => [getStoragePath(photo.url), getStoragePath(photo.thumbnailUrl)])
      .filter((path): path is string => Boolean(path));
    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([...new Set(storagePaths)]);
      if (storageError) {
        console.error('[deleteAccount] photo storage cleanup failed (account already deleted):', storageError.message);
      }
    }

    const { error: authError } = await supabase.auth.admin.deleteUser(dbUser.supabaseAuthId);
    if (authError) {
      console.error('[deleteAccount] Supabase auth user deletion failed (account data already deleted):', authError.message);
    }

    res.status(204).end();
  } catch (error) {
    console.error('[deleteAccount] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
