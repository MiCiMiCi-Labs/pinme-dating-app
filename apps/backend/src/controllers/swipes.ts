import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { hasBlockBetween } from '../lib/safety';
import { notifyMatchCreated } from '../lib/notifications';

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

    if (await hasBlockBetween(swiperId, targetId)) {
      res.status(403).json({ error: 'Cannot swipe this user' });
      return;
    }

    const existing = await prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId, targetId } },
    });
    if (existing) {
      const [user1Id, user2Id] = swiperId < targetId
        ? [swiperId, targetId]
        : [targetId, swiperId];
      const match = await prisma.match.findUnique({
        where: { user1Id_user2Id: { user1Id, user2Id } },
      });
      const message = match
        ? await prisma.message.findFirst({
            where: { matchId: match.id },
            orderBy: { createdAt: 'desc' },
            include: { sender: { select: { id: true, name: true } } },
          })
        : null;

      res.status(200).json({ swipe: existing, match, message });
      return;
    }

    const swipe = await prisma.swipe.create({
      data: { swiperId, targetId, action },
    });

    let match = null;
    let message = null;
    if (action === 'LIKE' || action === 'SUPER_LIKE') {
      const reverseSwipe = await prisma.swipe.findUnique({
        where: { swiperId_targetId: { swiperId: targetId, targetId: swiperId } },
      });

      console.log('[createSwipe] swiperId:', swiperId, 'targetId:', targetId, 'reverseSwipe:', reverseSwipe);

      if (reverseSwipe && (reverseSwipe.action === 'LIKE' || reverseSwipe.action === 'SUPER_LIKE')) {
        // Always store user1Id < user2Id to avoid duplicate match records
        const [user1Id, user2Id] = swiperId < targetId
          ? [swiperId, targetId]
          : [targetId, swiperId];

        match = await prisma.match.create({
          data: { user1Id, user2Id },
        });

        message = await prisma.message.create({
          data: {
            matchId: match.id,
            senderId: null,
            content: "Match successful, let's chat!",
            messageType: 'SYSTEM',
            isRead: true,
          },
          include: { sender: { select: { id: true, name: true } } },
        });

        void notifyMatchCreated(match).catch(error => {
          console.warn('[createSwipe] match notification failed:', error);
        });
      }
    }

    res.status(201).json({ swipe, match, message });
  } catch (err) {
    console.error('[createSwipe] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
