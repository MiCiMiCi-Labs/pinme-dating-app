import { Request, Response } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { prisma } from '../lib/prisma';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

async function resolveDbUser(supabaseAuthId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true, name: true },
  });
}

export async function getCallToken(req: Request, res: Response): Promise<void> {
  const matchId = req.params.matchId as string;
  const supabaseAuthId = req.userId!;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    res.status(503).json({ error: 'Voice calls are not configured on this server' });
    return;
  }

  const dbUser = await resolveDbUser(supabaseAuthId);
  if (!dbUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, user1Id: true, user2Id: true, unmatchedAt: true },
  });

  if (!match || (match.user1Id !== dbUser.id && match.user2Id !== dbUser.id)) {
    res.status(404).json({ error: 'Match not found' });
    return;
  }

  if (match.unmatchedAt) {
    res.status(403).json({ error: 'Match is no longer active' });
    return;
  }

  const roomName = `match:${matchId}`;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: dbUser.id,
    name: dbUser.name,
    ttl: '1h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  res.json({
    url: LIVEKIT_URL,
    token: await at.toJwt(),
    roomName,
  });
}
