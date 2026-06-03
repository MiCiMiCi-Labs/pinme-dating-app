import { Gender } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

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

    if (!authUser.email) {
      res
        .status(400)
        .json({ message: 'Authenticated user does not have an email address' });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { supabaseAuthId: authUser.id },
      include: { profile: true },
    });

    if (existingUser) {
      const user = await prisma.user.update({
        where: { supabaseAuthId: authUser.id },
        data: { email: authUser.email },
        include: { profile: true },
      });

      res.status(200).json({
        message: 'User synced successfully',
        user,
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
        email: authUser.email,
        name: name.trim(),
        gender: gender as Gender,
        birthday: parsedBirthday as Date,
      },
      include: { profile: true },
    });

    res.status(201).json({
      message: 'User synced successfully',
      user,
    });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ message: 'Failed to sync user' });
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
