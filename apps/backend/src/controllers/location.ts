import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function upsertLocation(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { latitude, longitude, city } = req.body;

    if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
      res.status(400).json({ error: 'latitude must be a number between -90 and 90' });
      return;
    }

    if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
      res.status(400).json({ error: 'longitude must be a number between -180 and 180' });
      return;
    }

    const location = await prisma.location.upsert({
      where: { userId: dbUserId },
      update: {
        latitude,
        longitude,
        ...(city !== undefined && { city: city ?? null }),
      },
      create: {
        userId: dbUserId,
        latitude,
        longitude,
        city: city ?? null,
      },
    });

    res.json(location);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
