import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const VALID_ACTIONS = ['LIKE', 'DISLIKE', 'SUPER_LIKE'] as const;

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function createSwipe(req: Request, res: Response) {
  try {
    const swiperId = await resolveDbUserId(req.userId!);
    if (!swiperId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { targetId, action } = req.body;

    if (!VALID_ACTIONS.includes(action)) {
      res.status(400).json({ error: 'action must be LIKE, DISLIKE, or SUPER_LIKE' });
      return;
    }

    if (!targetId || typeof targetId !== 'string') {
      res.status(400).json({ error: 'targetId is required' });
      return;
    }

    if (swiperId === targetId) {
      res.status(400).json({ error: 'Cannot swipe yourself' });
      return;
    }

    const targetExists = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!targetExists) {
      res.status(404).json({ error: 'Target user not found' });
      return;
    }

    const existing = await prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId, targetId } },
    });
    if (existing) {
      res.status(409).json({ error: 'Already swiped on this user' });
      return;
    }

    const swipe = await prisma.swipe.create({
      data: { swiperId, targetId, action },
    });

    let match = null;
    if (action === 'LIKE' || action === 'SUPER_LIKE') {
      const reverseSwipe = await prisma.swipe.findUnique({
        where: { swiperId_targetId: { swiperId: targetId, targetId: swiperId } },
      });

      if (reverseSwipe && (reverseSwipe.action === 'LIKE' || reverseSwipe.action === 'SUPER_LIKE')) {
        // Always store user1Id < user2Id to avoid duplicate match records
        const [user1Id, user2Id] = swiperId < targetId
          ? [swiperId, targetId]
          : [targetId, swiperId];

        match = await prisma.match.create({
          data: { user1Id, user2Id },
        });
      }
    }

    res.status(201).json({ swipe, match });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
