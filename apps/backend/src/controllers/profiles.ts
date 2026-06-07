import { RelationshipGoal } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const nullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const profileSchema = z
  .object({
    city: nullableString(120),
    bio: nullableString(500),
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
    where: { supabaseAuthId: authUserId },
    select: {
      id: true,
      email: true,
      name: true,
      gender: true,
      birthday: true,
      city: true,
      bio: true,
    },
  });
}

export async function getMyProfile(req: Request, res: Response) {
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

    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });

    res.status(200).json({ user, profile });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Failed to get profile' });
  }
}

export async function updateMyProfile(req: Request, res: Response) {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const parsedBody = profileSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        message: 'Invalid profile payload',
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

    const { city, bio, ...profileData } = parsedBody.data;

    const [updatedUser, profile] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          ...(city !== undefined ? { city } : {}),
          ...(bio !== undefined ? { bio } : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          gender: true,
          birthday: true,
          city: true,
          bio: true,
        },
      }),
      prisma.profile.upsert({
        where: { userId: user.id },
        update: profileData,
        create: {
          userId: user.id,
          ...profileData,
        },
      }),
    ]);

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
      profile,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
}
