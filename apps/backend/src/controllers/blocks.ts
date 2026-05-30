import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function blockUser(req: Request, res: Response) {
  try {
    const blockerId = await resolveDbUserId(req.userId!);
    if (!blockerId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { blockedId } = req.body;

    if (!blockedId || typeof blockedId !== 'string') {
      res.status(400).json({ error: 'blockedId is required' });
      return;
    }

    if (blockerId === blockedId) {
      res.status(400).json({ error: 'Cannot block yourself' });
      return;
    }

    const targetExists = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!targetExists) {
      res.status(404).json({ error: 'Target user not found' });
      return;
    }

    const existing = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (existing) {
      res.status(409).json({ error: 'User already blocked' });
      return;
    }

    const [block] = await prisma.$transaction([
      prisma.block.create({ data: { blockerId, blockedId } }),
      // Soft-delete any active match between the two users
      prisma.match.updateMany({
        where: {
          unmatchedAt: null,
          OR: [
            { user1Id: blockerId, user2Id: blockedId },
            { user1Id: blockedId, user2Id: blockerId },
          ],
        },
        data: { unmatchedAt: new Date() },
      }),
    ]);

    res.status(201).json(block);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function unblockUser(req: Request, res: Response) {
  try {
    const blockerId = await resolveDbUserId(req.userId!);
    if (!blockerId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const blockedId = req.params.blockedUserId as string;

    const block = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (!block) {
      res.status(404).json({ error: 'Block not found' });
      return;
    }

    await prisma.block.delete({
      where: { blockerId_blockedId: { blockerId, blockedId } },
    });

    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
