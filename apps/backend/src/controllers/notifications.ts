import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const registerPushTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.string().max(32).optional(),
});

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function registerPushToken(req: Request, res: Response) {
  try {
    const parsed = registerPushTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid push token payload',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const userId = await resolveDbUserId(req.userId!);
    if (!userId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const token = await prisma.pushToken.upsert({
      where: { token: parsed.data.token },
      update: {
        userId,
        platform: parsed.data.platform,
        isActive: true,
      },
      create: {
        userId,
        token: parsed.data.token,
        platform: parsed.data.platform,
      },
    });

    res.status(200).json({ token });
  } catch (error) {
    console.error('[registerPushToken] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
