import { Gender } from '@prisma/client';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

function parseBirthday(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const birthday = new Date(value);

  if (Number.isNaN(birthday.getTime())) {
    return null;
  }

  return birthday;
}

// POST /api/v1/auth/sync
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      return res.status(401).json({
        message: 'Unauthorized',
      });
    }

    if (!authUser.email) {
      return res.status(400).json({
        message: 'Authenticated user does not have an email address',
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        supabaseAuthId: authUser.id,
      },
      include: {
        profile: true,
      },
    });

    if (existingUser) {
      const user = await prisma.user.update({
        where: {
          supabaseAuthId: authUser.id,
        },
        data: {
          email: authUser.email,
        },
        include: {
          profile: true,
        },
      });

      return res.status(200).json({
        message: 'User synced successfully',
        user,
      });
    }

    const { name, gender, birthday } = req.body;
    const parsedBirthday = parseBirthday(birthday);

    const validationErrors: string[] = [];

    if (typeof name !== 'string' || !name.trim()) {
      validationErrors.push('name is required');
    }

    if (
      typeof gender !== 'string' ||
      !Object.values(Gender).includes(gender as Gender)
    ) {
      validationErrors.push(
        `gender must be one of: ${Object.values(Gender).join(', ')}`
      );
    }

    if (!parsedBirthday) {
      validationErrors.push('birthday must be a valid date, e.g. 2000-01-01');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'name, gender, and birthday are required to create an app user',
        errors: validationErrors,
        received: {
          name,
          gender,
          birthday,
        },
      });
    }

    const userBirthday = parsedBirthday as Date;

    const user = await prisma.user.create({
      data: {
        supabaseAuthId: authUser.id,
        email: authUser.email,
        name: name.trim(),
        gender: gender as Gender,
        birthday: userBirthday,
      },
      include: {
        profile: true,
      },
    });

    return res.status(201).json({
      message: 'User synced successfully',
      user,
    });
  } catch (error) {
    console.error('Auth sync error:', error);

    return res.status(500).json({
      message: 'Failed to sync user',
    });
  }
});

// GET /api/v1/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      return res.status(401).json({
        message: 'Unauthorized',
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        supabaseAuthId: authUser.id,
      },
      include: {
        profile: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        message: 'App user not found. Please sync user first.',
      });
    }

    return res.status(200).json({
      user,
    });
  } catch (error) {
    console.error('Get current user error:', error);

    return res.status(500).json({
      message: 'Failed to get current user',
    });
  }
});

export default router;
