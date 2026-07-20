import { Gender } from '@prisma/client';
import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';

const MINIMUM_AGE = 18;

function getSyncErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const maybePrisma = error as Error & {
      code?: string;
      meta?: unknown;
      clientVersion?: string;
    };
    const parts = [error.message];

    if (typeof maybePrisma.code === 'string') {
      parts.push(`code=${maybePrisma.code}`);
    }

    if (maybePrisma.meta) {
      parts.push(`meta=${JSON.stringify(maybePrisma.meta)}`);
    }

    if (typeof maybePrisma.clientVersion === 'string') {
      parts.push(`clientVersion=${maybePrisma.clientVersion}`);
    }

    return parts.join(' | ');
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown sync error';
  }
}

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

export async function syncCurrentUser(req: Request, res: Response) {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    // Email/phone are optional identifiers used only to merge with an
    // existing account — supabaseAuthId is the real anchor. Some sign-in
    // methods legitimately have neither: Apple omits the email claim on any
    // authorization after the user's first-ever one, and Google/Facebook
    // both allow the user to deny the email permission.
    const authEmail = authUser.email?.trim() || null;
    const authPhone = authUser.phone?.trim() || null;

    const [userByAuthId, userByEmail, userByPhone] = await Promise.all([
      prisma.user.findUnique({
        where: { supabaseAuthId: authUser.id },
        include: { profile: true },
      }),
      authEmail
        ? prisma.user.findUnique({
            where: { email: authEmail },
            include: { profile: true },
          })
        : Promise.resolve(null),
      authPhone
        ? prisma.user.findUnique({
            where: { phone: authPhone },
            include: { profile: true },
          })
        : Promise.resolve(null),
    ]);

    const existingUser = userByAuthId ?? userByEmail ?? userByPhone;

    if (existingUser) {
      const userUpdateData: {
        supabaseAuthId: string;
        email?: string | null;
        phone?: string | null;
      } = { supabaseAuthId: authUser.id };

      if (authEmail && (!userByEmail || userByEmail.id === existingUser.id)) {
        userUpdateData.email = authEmail;
      }

      if (authPhone && (!userByPhone || userByPhone.id === existingUser.id)) {
        userUpdateData.phone = authPhone;
      }

      const [user] = await prisma.$transaction([
        prisma.user.update({
          where: { id: existingUser.id },
          data: userUpdateData,
          include: { profile: true },
        }),
        prisma.privacySettings.upsert({
          where: { userId: existingUser.id },
          update: {},
          create: { userId: existingUser.id, discoverable: true, showDistance: false, showOnlineStatus: true },
        }),
      ]);

      res.status(200).json({
        message: 'User synced successfully',
        user,
      });
      return;
    }

    if (req.body.createIfMissing === false) {
      res.status(404).json({
        message: 'App user not found. Complete profile first.',
      });
      return;
    }

    const metadata = authUser.user_metadata ?? {};
    const name = req.body.name ?? metadata.name;
    const gender = req.body.gender ?? metadata.gender;
    const birthday = req.body.birthday ?? metadata.birthday;
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
    } else if (calculateAge(parsedBirthday) < MINIMUM_AGE) {
      validationErrors.push(`you must be at least ${MINIMUM_AGE} to use PinMe`);
    }

    if (validationErrors.length > 0) {
      res.status(400).json({
        message: 'name, gender, and birthday are required to create an app user',
        errors: validationErrors,
        received: { name, gender, birthday },
      });
      return;
    }

    const user = await prisma.user.create({
      data: {
        supabaseAuthId: authUser.id,
        email: authEmail,
        phone: authPhone,
        name: name.trim(),
        gender: gender as Gender,
        birthday: parsedBirthday as Date,
        privacySettings: {
          create: { discoverable: true, showDistance: false, showOnlineStatus: true },
        },
      },
      include: { profile: true },
    });

    res.status(201).json({
      message: 'User synced successfully',
      user,
    });
  } catch (error) {
    const detail = getSyncErrorDetail(error);
    console.error('Auth sync error:', detail);
    res.status(500).json({
      message: 'Failed to sync user',
      ...(process.env.NODE_ENV !== 'production' ? { detail } : {}),
    });
  }
}

export async function getCurrentUser(req: Request, res: Response) {
  try {
    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { supabaseAuthId: authUser.id },
      include: { profile: true },
    });

    if (!user) {
      res
        .status(404)
        .json({ message: 'App user not found. Please sync user first.' });
      return;
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ message: 'Failed to get current user' });
  }
}
