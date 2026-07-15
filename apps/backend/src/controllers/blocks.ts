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
      res.status(200).json(existing);
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
      prisma.swipe.deleteMany({
        where: {
          OR: [
            { swiperId: blockerId, targetId: blockedId },
            { swiperId: blockedId, targetId: blockerId },
          ],
        },
      }),
    ]);

    // If blocker and blocked are both currently active in the same voice
    // room(s), close out the blocked party's participation there too, so they
    // no longer show up as sharing a live room with the blocker.
    //
    // Known limitation: this only updates our own DB bookkeeping. Any LiveKit
    // access token the blocked user already holds for that room remains
    // valid for the rest of its TTL (createVoiceRoomToken issues 2h tokens),
    // so their client can keep publishing/subscribing audio in that room
    // until the token expires or they disconnect on their own. Actually
    // evicting them in real time would need calling LiveKit's
    // RoomServiceClient.removeParticipant(livekitRoomName, blockedId) against
    // the LiveKit server — the livekit-server-sdk package already used here
    // for AccessToken also exports RoomServiceClient, so no new dependency
    // would be required — but that call isn't made here because it can't be
    // exercised against a real LiveKit deployment in this change, and a
    // best-effort call left untested in a safety-sensitive path is worse than
    // being explicit about the gap.
    const blockerActiveRooms = await prisma.voiceRoomParticipant.findMany({
      where: { userId: blockerId, leftAt: null },
      select: { roomId: true },
    });

    if (blockerActiveRooms.length > 0) {
      await prisma.voiceRoomParticipant.updateMany({
        where: {
          userId: blockedId,
          leftAt: null,
          roomId: { in: blockerActiveRooms.map(p => p.roomId) },
        },
        data: { leftAt: new Date() },
      });
    }

    res.status(201).json(block);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getBlockedUsers(req: Request, res: Response) {
  try {
    const blockerId = await resolveDbUserId(req.userId!);
    if (!blockerId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const blocks = await prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: {
          select: {
            id: true,
            name: true,
            city: true,
            photos: {
              orderBy: [{ isPrimary: 'desc' }, { orderIndex: 'asc' }],
              take: 1,
            },
          },
        },
      },
    });

    res.json({ blocks });
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
