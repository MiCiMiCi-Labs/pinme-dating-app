import { RelationshipGoal } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const nullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const profileSchema = z
  .object({
    height: z.number().int().min(90).max(250).nullable().optional(),
    education: nullableString(120),
    jobTitle: nullableString(120),
    company: nullableString(120),
    relationshipGoal: z.nativeEnum(RelationshipGoal).nullable().optional(),
    drinking: nullableString(60),
    smoking: nullableString(60),
    mbti: nullableString(20),
    constellation: nullableString(40),
    prompt1: nullableString(500),
    prompt2: nullableString(500),
  })
  .strict();

async function getCurrentAppUser(authUserId: string) {
  return prisma.user.findUnique({
    where: {
      supabaseAuthId: authUserId,
    },
    select: {
      id: true,
    },
  });
}

// GET /api/profile/me
// GET /api/v1/profiles/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await getCurrentAppUser(authUser.id);

    if (!user) {
      return res.status(404).json({
        message: 'App user not found. Please sync user first.',
      });
    }

    const profile = await prisma.profile.findUnique({
      where: {
        userId: user.id,
      },
    });

    return res.status(200).json({ profile });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Failed to get profile' });
  }
});

// PUT /api/profile/me
// PUT /api/v1/profiles/me
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const parsedBody = profileSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return res.status(400).json({
        message: 'Invalid profile payload',
        errors: parsedBody.error.flatten().fieldErrors,
      });
    }

    const user = await getCurrentAppUser(authUser.id);

    if (!user) {
      return res.status(404).json({
        message: 'App user not found. Please sync user first.',
      });
    }

    const profile = await prisma.profile.upsert({
      where: {
        userId: user.id,
      },
      update: parsedBody.data,
      create: {
        userId: user.id,
        ...parsedBody.data,
      },
    });

    return res.status(200).json({
      message: 'Profile updated successfully',
      profile,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
});

export default router;
