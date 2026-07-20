import { Gender } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const preferencesSchema = z.object({
  preferredGender: z.nativeEnum(Gender).nullable().optional(),
  minAge: z.number().int().min(18).max(120).nullable().optional(),
  maxAge: z.number().int().min(18).max(120).nullable().optional(),
  maxDistanceKm: z.number().int().min(1).max(500).nullable().optional(),
  minHeight: z.number().int().min(90).max(250).nullable().optional(),
  maxHeight: z.number().int().min(90).max(250).nullable().optional(),
}).strict();

async function getCurrentAppUser(authUserId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId: authUserId },
    select: { id: true },
  });
}

export async function getMyPreferences(req: Request, res: Response) {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const user = await getCurrentAppUser(authUser.id);

    if (!user) {
      res
        .status(404)
        .json({ message: 'App user not found. Please sync user first.' });
      return;
    }

    const preferences = await prisma.preference.findUnique({
      where: { userId: user.id },
    });

    res.status(200).json({ preferences });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ message: 'Failed to get preferences' });
  }
}

export async function updateMyPreferences(req: Request, res: Response) {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const parsedBody = preferencesSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        message: 'Invalid preferences payload',
        errors: parsedBody.error.flatten().fieldErrors,
      });
      return;
    }

    const user = await getCurrentAppUser(authUser.id);

    if (!user) {
      res
        .status(404)
        .json({ message: 'App user not found. Please sync user first.' });
      return;
    }

    // A partial update (e.g. just { minAge: 50 }) only carries the fields
    // the client actually changed. Validating cross-field constraints
    // (min <= max) against that partial payload alone can't see a
    // pre-existing max from a previous save, so an update that's fine on
    // its own could still leave the row in an impossible state (e.g.
    // minAge=50 on top of an existing maxAge=35). Merge onto the current
    // row first, then validate the result that will actually be stored.
    const existing = await prisma.preference.findUnique({ where: { userId: user.id } });
    const merged = { ...existing, ...parsedBody.data };

    if (
      merged.minAge != null &&
      merged.maxAge != null &&
      merged.minAge > merged.maxAge
    ) {
      res.status(400).json({
        message: 'Invalid preferences payload',
        errors: { minAge: ['minAge must be less than or equal to maxAge'] },
      });
      return;
    }

    if (
      merged.minHeight != null &&
      merged.maxHeight != null &&
      merged.minHeight > merged.maxHeight
    ) {
      res.status(400).json({
        message: 'Invalid preferences payload',
        errors: { minHeight: ['minHeight must be less than or equal to maxHeight'] },
      });
      return;
    }

    const preferences = await prisma.preference.upsert({
      where: { userId: user.id },
      update: parsedBody.data,
      create: {
        userId: user.id,
        ...parsedBody.data,
      },
    });

    res.status(200).json({
      message: 'Preferences updated successfully',
      preferences,
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ message: 'Failed to update preferences' });
  }
}
