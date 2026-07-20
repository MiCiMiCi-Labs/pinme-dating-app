import { Gender, RelationshipGoal } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';

const MINIMUM_AGE = 18;

const nullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const optionalStringArray = z.array(z.string().trim().min(1).max(80)).max(20).optional();

// The 18+ requirement is enforced client-side in the onboarding wizard, but
// this endpoint is also reachable directly (e.g. editing your profile later),
// so the minimum has to be checked here too — otherwise a raw request can
// create/edit an under-18 account and it lands straight in the discovery
// pool.
const birthdayString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'birthday must be a valid date',
  })
  .refine((value) => calculateAge(new Date(value)) >= MINIMUM_AGE, {
    message: `you must be at least ${MINIMUM_AGE} to use PinMe`,
  });

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    gender: z.nativeEnum(Gender).optional(),
    birthday: birthdayString.optional(),
    city: nullableString(120),
    bio: nullableString(500),
    height: z.number().int().min(90).max(250).nullable().optional(),
    pronouns: nullableString(80),
    sexualOrientation: nullableString(120),
    sexualOrientationVisible: z.boolean().optional(),
    education: nullableString(120),
    educationLevel: nullableString(120),
    jobTitle: nullableString(120),
    company: nullableString(120),
    companyVisible: z.boolean().optional(),
    languages: optionalStringArray,
    hometown: nullableString(120),
    relationshipGoal: z.nativeEnum(RelationshipGoal).nullable().optional(),
    drinking: nullableString(60),
    smoking: nullableString(60),
    exercise: nullableString(80),
    dietary: nullableString(80),
    drugs: nullableString(80),
    pets: nullableString(80),
    sleepHabit: nullableString(80),
    socialHabit: nullableString(80),
    children: nullableString(80),
    wantsChildren: nullableString(80),
    relationshipStyle: nullableString(120),
    communicationStyle: nullableString(120),
    idealFirstDate: nullableString(500),
    interests: optionalStringArray,
    weekend: nullableString(500),
    favorites: nullableString(500),
    mbti: nullableString(20),
    constellation: nullableString(40),
    prompt1Question: nullableString(160),
    prompt1: nullableString(500),
    prompt2Question: nullableString(160),
    prompt2: nullableString(500),
    prompt3Question: nullableString(160),
    prompt3: nullableString(500),
    hiddenFields: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
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

    const { name, gender, birthday, city, bio, ...profileData } = parsedBody.data;

    const [updatedUser, profile] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(gender !== undefined ? { gender } : {}),
          ...(birthday !== undefined ? { birthday: new Date(birthday) } : {}),
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
