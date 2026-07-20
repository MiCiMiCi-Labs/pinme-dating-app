import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function getPrivacy(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const settings = await prisma.privacySettings.findUnique({
      where: { userId: dbUserId },
    });

    // Return defaults if not yet created
    res.json(
      settings ?? {
        discoverable: true,
        showDistance: false,
        showOnlineStatus: true,
      }
    );
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function updatePrivacy(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { discoverable, showDistance, showOnlineStatus } = req.body;

    const data: Record<string, boolean> = {};
    if (typeof discoverable === 'boolean') data.discoverable = discoverable;
    if (typeof showDistance === 'boolean') data.showDistance = showDistance;
    if (typeof showOnlineStatus === 'boolean') data.showOnlineStatus = showOnlineStatus;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No valid fields provided' });
      return;
    }

    const settings = await prisma.privacySettings.upsert({
      where: { userId: dbUserId },
      update: data,
      create: {
        userId: dbUserId,
        discoverable: data.discoverable ?? true,
        showDistance: data.showDistance ?? false,
        showOnlineStatus: data.showOnlineStatus ?? true,
      },
    });

    res.json(settings);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
