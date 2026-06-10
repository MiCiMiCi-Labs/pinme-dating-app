import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

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
    const { id } = req.params;

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

    const { birthday, ...rest } = user;
    res.json({ user: { ...rest, age: calculateAge(birthday) } });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
