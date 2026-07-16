import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hasBlockBetween } from '../lib/safety';
import { INVITATION_COOLDOWN_MS, recordCallOutcomeMessage } from '../lib/calls';
import { MessageType } from '@prisma/client';

async function resolveDbUser(supabaseAuthId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true, name: true },
  });
}

type MatchParticipants = {
  id: string;
  user1Id: string;
  user2Id: string;
  unmatchedAt: Date | null;
};

async function loadMatchForParticipant(
  matchId: string,
  userId: string
): Promise<MatchParticipants | null> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, user1Id: true, user2Id: true, unmatchedAt: true },
  });

  if (!match || (match.user1Id !== userId && match.user2Id !== userId)) {
    return null;
  }

  return match;
}

function otherParticipant(match: MatchParticipants, userId: string): string {
  return match.user1Id === userId ? match.user2Id : match.user1Id;
}

async function computePreferenceState(matchId: string, userId: string, otherId: string) {
  const [mine, theirs, blocked] = await Promise.all([
    prisma.callPreference.findUnique({ where: { matchId_userId: { matchId, userId } } }),
    prisma.callPreference.findUnique({
      where: { matchId_userId: { matchId, userId: otherId } },
    }),
    hasBlockBetween(userId, otherId),
  ]);

  const mineEnabled = mine?.audioEnabled ?? false;
  const theirsEnabled = theirs?.audioEnabled ?? false;

  return {
    mineEnabled,
    theirsEnabled,
    mutuallyEnabled: mineEnabled && theirsEnabled && !blocked,
  };
}

export async function getCallPreference(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const matchId = req.params.matchId as string;
    const match = await loadMatchForParticipant(matchId, dbUser.id);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const state = await computePreferenceState(matchId, dbUser.id, otherParticipant(match, dbUser.id));
    res.json(state);
  } catch (error) {
    console.error('[getCallPreference] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

const updatePreferenceSchema = z.object({ audioEnabled: z.boolean() }).strict();

export async function updateCallPreference(req: Request, res: Response): Promise<void> {
  try {
    const parsed = updatePreferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const matchId = req.params.matchId as string;
    const match = await loadMatchForParticipant(matchId, dbUser.id);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const { audioEnabled } = parsed.data;

    if (audioEnabled && match.unmatchedAt) {
      res.status(403).json({ error: 'Match is no longer active' });
      return;
    }

    const otherId = otherParticipant(match, dbUser.id);

    if (audioEnabled && (await hasBlockBetween(dbUser.id, otherId))) {
      res.status(403).json({ error: 'Voice calling is unavailable for this match' });
      return;
    }

    await prisma.callPreference.upsert({
      where: { matchId_userId: { matchId, userId: dbUser.id } },
      create: { matchId, userId: dbUser.id, audioEnabled },
      update: { audioEnabled },
    });

    if (!audioEnabled) {
      // Turning off mid-ring cancels the pending call, but never force-ends
      // an already-ACCEPTED call (per spec: disabling only blocks the *next*
      // call).
      await prisma.$transaction(async (tx) => {
        const ringing = await tx.call.findFirst({
          where: {
            matchId,
            status: 'RINGING',
            OR: [{ callerId: dbUser.id }, { calleeId: dbUser.id }],
          },
        });

        if (!ringing) return;

        const result = await tx.call.updateMany({
          where: { id: ringing.id, status: 'RINGING' },
          data: { status: 'CANCELED', endedAt: new Date(), endedById: dbUser.id },
        });

        if (result.count === 0) return;

        const updated = await tx.call.findUniqueOrThrow({ where: { id: ringing.id } });
        await recordCallOutcomeMessage(tx, updated);
      });
    }

    const state = await computePreferenceState(matchId, dbUser.id, otherId);
    res.json(state);
  } catch (error) {
    console.error('[updateCallPreference] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createCallInvitation(req: Request, res: Response): Promise<void> {
  try {
    const dbUser = await resolveDbUser(req.userId!);
    if (!dbUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const matchId = req.params.matchId as string;
    const match = await loadMatchForParticipant(matchId, dbUser.id);
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (match.unmatchedAt) {
      res.status(403).json({ error: 'Match is no longer active' });
      return;
    }

    const otherId = otherParticipant(match, dbUser.id);

    if (await hasBlockBetween(dbUser.id, otherId)) {
      res.status(403).json({ error: 'Voice calling is unavailable for this match' });
      return;
    }

    const existing = await prisma.callPreference.findUnique({
      where: { matchId_userId: { matchId, userId: dbUser.id } },
    });

    if (existing?.lastInvitedAt) {
      const elapsed = Date.now() - existing.lastInvitedAt.getTime();
      if (elapsed < INVITATION_COOLDOWN_MS) {
        res.status(429).json({
          error: 'Voice chat invitation was already sent recently',
          retryAfterMs: INVITATION_COOLDOWN_MS - elapsed,
        });
        return;
      }
    }

    const now = new Date();
    const [, message] = await prisma.$transaction([
      prisma.callPreference.upsert({
        where: { matchId_userId: { matchId, userId: dbUser.id } },
        create: { matchId, userId: dbUser.id, audioEnabled: true, lastInvitedAt: now },
        update: { audioEnabled: true, lastInvitedAt: now },
      }),
      prisma.message.create({
        data: {
          matchId,
          senderId: null,
          messageType: MessageType.SYSTEM,
          content: `${dbUser.name} invited you to enable voice chat.`,
        },
      }),
    ]);

    const state = await computePreferenceState(matchId, dbUser.id, otherId);
    res.status(201).json({ message, ...state });
  } catch (error) {
    console.error('[createCallInvitation] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
