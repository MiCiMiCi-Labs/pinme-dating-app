import crypto from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

export const VOICE_ROOM_TAGS = [
  'Tonight',
  'Chat',
  'Friends',
  'Dating',
  'Music',
  'Movies',
  'Gaming',
  'Travel',
  'Food',
  'Fitness',
  'Photos',
  'Tech',
  'Study',
  'English',
  'Vent',
  'Late Night',
  'Weekend',
  'Auckland',
  'Serious',
  'Casual',
] as const;

const allowedTags = new Set<string>(VOICE_ROOM_TAGS);

const createRoomSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    tags: z.array(z.string()).min(1).max(3),
  })
  .strict()
  .refine(data => data.tags.every(tag => allowedTags.has(tag)), {
    message: 'Invalid voice room tag',
    path: ['tags'],
  });

const muteParticipantSchema = z
  .object({
    userId: z.string().uuid(),
    muted: z.boolean(),
  })
  .strict();

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function resolveDbUser(supabaseAuthId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true, name: true },
  });
}

function ensureLiveKitConfigured(res: Response) {
  if (LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL) return true;
  res.status(503).json({ error: 'Voice rooms are not configured on this server' });
  return false;
}

function userPhotoSelect() {
  return {
    orderBy: { orderIndex: 'asc' as const },
    select: {
      id: true,
      url: true,
      thumbnailUrl: true,
      isPrimary: true,
      isVerified: true,
      orderIndex: true,
    },
  };
}

const roomInclude = {
  owner: {
    select: {
      id: true,
      name: true,
      photos: userPhotoSelect(),
    },
  },
  participants: {
    where: { leftAt: null },
    orderBy: { joinedAt: 'asc' as const },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          photos: userPhotoSelect(),
        },
      },
    },
  },
};

function serializeRoom(room: any) {
  return {
    id: room.id,
    ownerId: room.ownerId,
    name: room.name,
    tags: room.tags,
    livekitRoomName: room.livekitRoomName,
    isOpen: room.isOpen,
    createdAt: room.createdAt,
    closedAt: room.closedAt,
    owner: room.owner,
    participantCount: room.participants.length,
    participants: room.participants.map((participant: any) => ({
      id: participant.id,
      userId: participant.userId,
      isMutedByHost: participant.isMutedByHost,
      joinedAt: participant.joinedAt,
      user: participant.user,
    })),
  };
}

async function createVoiceRoomToken(room: { livekitRoomName: string }, user: { id: string; name: string }, canPublish: boolean) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.name,
    ttl: '2h',
  });

  token.addGrant({
    roomJoin: true,
    room: room.livekitRoomName,
    canPublish,
    canSubscribe: true,
    canPublishData: false,
  });

  return token.toJwt();
}

export function getVoiceRoomTags(_req: Request, res: Response) {
  res.json({ tags: VOICE_ROOM_TAGS });
}

export async function listVoiceRooms(req: Request, res: Response) {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const rooms = await prisma.voiceRoom.findMany({
      where: {
        isOpen: true,
        ...(search
          ? {
              OR: [
                { id: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: roomInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ rooms: rooms.map(serializeRoom) });
  } catch (err) {
    console.error('[listVoiceRooms] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createVoiceRoom(req: Request, res: Response) {
  try {
    const parsedBody = createRoomSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Invalid voice room payload', details: parsedBody.error.flatten().fieldErrors });
      return;
    }

    const owner = await resolveDbUser(req.userId!);
    if (!owner) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const roomId = crypto.randomUUID();
    const room = await prisma.voiceRoom.create({
      data: {
        id: roomId,
        ownerId: owner.id,
        name: parsedBody.data.name,
        tags: parsedBody.data.tags,
        livekitRoomName: `voice-room:${roomId}`,
        participants: {
          create: {
            userId: owner.id,
          },
        },
      },
      include: roomInclude,
    });

    res.status(201).json({ room: serializeRoom(room) });
  } catch (err) {
    console.error('[createVoiceRoom] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getVoiceRoom(req: Request, res: Response) {
  try {
    const roomId = firstParam(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Missing voice room id' });
      return;
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: roomInclude,
    });

    if (!room) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    res.json({ room: serializeRoom(room) });
  } catch (err) {
    console.error('[getVoiceRoom] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function joinVoiceRoom(req: Request, res: Response) {
  try {
    if (!ensureLiveKitConfigured(res)) return;

    const roomId = firstParam(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Missing voice room id' });
      return;
    }

    const user = await resolveDbUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      include: roomInclude,
    });

    if (!room || !room.isOpen) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    const participant = await prisma.voiceRoomParticipant.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: user.id,
        },
      },
      update: {
        leftAt: null,
        joinedAt: new Date(),
      },
      create: {
        roomId: room.id,
        userId: user.id,
      },
    });

    const updatedRoom = await prisma.voiceRoom.findUniqueOrThrow({
      where: { id: room.id },
      include: roomInclude,
    });

    res.json({
      room: serializeRoom(updatedRoom),
      token: await createVoiceRoomToken(room, user, !participant.isMutedByHost),
      url: LIVEKIT_URL,
      participant: {
        id: participant.id,
        userId: participant.userId,
        isMutedByHost: participant.isMutedByHost,
      },
    });
  } catch (err) {
    console.error('[joinVoiceRoom] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function leaveVoiceRoom(req: Request, res: Response) {
  try {
    const roomId = firstParam(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Missing voice room id' });
      return;
    }

    const user = await resolveDbUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, ownerId: true, isOpen: true },
    });

    if (!room) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    if (room.isOpen && room.ownerId === user.id) {
      res.status(409).json({ error: 'Room owner must close the room to leave' });
      return;
    }

    await prisma.voiceRoomParticipant.updateMany({
      where: { roomId: room.id, userId: user.id },
      data: { leftAt: new Date() },
    });

    res.status(204).send();
  } catch (err) {
    console.error('[leaveVoiceRoom] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function closeVoiceRoom(req: Request, res: Response) {
  try {
    const roomId = firstParam(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Missing voice room id' });
      return;
    }

    const user = await resolveDbUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, ownerId: true, isOpen: true },
    });

    if (!room) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    if (room.ownerId !== user.id) {
      res.status(403).json({ error: 'Only the room owner can close this room' });
      return;
    }

    const now = new Date();
    const [updatedRoom] = await prisma.$transaction([
      prisma.voiceRoom.update({
        where: { id: room.id },
        data: { isOpen: false, closedAt: now },
        include: roomInclude,
      }),
      prisma.voiceRoomParticipant.updateMany({
        where: { roomId: room.id, leftAt: null },
        data: { leftAt: now },
      }),
    ]);

    res.json({ room: serializeRoom(updatedRoom) });
  } catch (err) {
    console.error('[closeVoiceRoom] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function muteVoiceRoomParticipant(req: Request, res: Response) {
  try {
    const roomId = firstParam(req.params.roomId);
    if (!roomId) {
      res.status(400).json({ error: 'Missing voice room id' });
      return;
    }

    const parsedBody = muteParticipantSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'Invalid mute payload', details: parsedBody.error.flatten().fieldErrors });
      return;
    }

    const user = await resolveDbUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const room = await prisma.voiceRoom.findUnique({
      where: { id: roomId },
      select: { id: true, ownerId: true, isOpen: true },
    });

    if (!room || !room.isOpen) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    if (room.ownerId !== user.id) {
      res.status(403).json({ error: 'Only the room owner can mute participants' });
      return;
    }

    if (parsedBody.data.userId === room.ownerId) {
      res.status(400).json({ error: 'Room owner cannot be muted' });
      return;
    }

    await prisma.voiceRoomParticipant.updateMany({
      where: {
        roomId: room.id,
        userId: parsedBody.data.userId,
        leftAt: null,
      },
      data: {
        isMutedByHost: parsedBody.data.muted,
      },
    });

    const updatedRoom = await prisma.voiceRoom.findUniqueOrThrow({
      where: { id: room.id },
      include: roomInclude,
    });

    res.json({ room: serializeRoom(updatedRoom) });
  } catch (err) {
    console.error('[muteVoiceRoomParticipant] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
