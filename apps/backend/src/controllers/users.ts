import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sanitizePublicProfile } from '../lib/publicProfile';
import { hasBlockBetween } from '../lib/safety';

function calculateAge(birthday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age -= 1;
  }
  return age;
}

export async function getUserById(req: Request, res: Response) {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!id) {
      res.status(400).json({ error: 'User id is required' });
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

    if (await hasBlockBetween(currentUser.id, id)) {
      res.status(403).json({ error: 'Profile is unavailable' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        gender: true,
        birthday: true,
        bio: true,
        city: true,
        profile: true,
        photos: {
          orderBy: [{ isPrimary: 'desc' }, { orderIndex: 'asc' }],
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { birthday, profile, ...rest } = user;
    res.json({
      user: {
        ...rest,
        profile: sanitizePublicProfile(profile),
        age: calculateAge(birthday),
      },
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
