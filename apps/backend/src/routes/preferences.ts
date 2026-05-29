import { Gender } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();

const preferencesSchema = z
  .object({
    preferredGender: z.nativeEnum(Gender).nullable().optional(),
    minAge: z.number().int().min(18).max(120).nullable().optional(),
    maxAge: z.number().int().min(18).max(120).nullable().optional(),
    maxDistanceKm: z.number().int().min(1).max(500).nullable().optional(),
    minHeight: z.number().int().min(90).max(250).nullable().optional(),
    maxHeight: z.number().int().min(90).max(250).nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.minAge == null || data.maxAge == null || data.minAge <= data.maxAge,
    {
      message: 'minAge must be less than or equal to maxAge',
      path: ['minAge'],
    }
  )
  .refine(
    (data) =>
      data.minHeight == null ||
      data.maxHeight == null ||
      data.minHeight <= data.maxHeight,
    {
      message: 'minHeight must be less than or equal to maxHeight',
      path: ['minHeight'],
    }
  );

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

// GET /api/preferences/me
// GET /api/v1/preferences/me
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

    const preferences = await prisma.preference.findUnique({
      where: {
        userId: user.id,
      },
    });

    return res.status(200).json({ preferences });
  } catch (error) {
    console.error('Get preferences error:', error);
    return res.status(500).json({ message: 'Failed to get preferences' });
  }
});

// PUT /api/preferences/me
// PUT /api/v1/preferences/me
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const parsedBody = preferencesSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return res.status(400).json({
        message: 'Invalid preferences payload',
        errors: parsedBody.error.flatten().fieldErrors,
      });
    }

    const user = await getCurrentAppUser(authUser.id);

    if (!user) {
      return res.status(404).json({
        message: 'App user not found. Please sync user first.',
      });
    }

    const preferences = await prisma.preference.upsert({
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
      message: 'Preferences updated successfully',
      preferences,
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    return res.status(500).json({ message: 'Failed to update preferences' });
  }
});

export default router;
