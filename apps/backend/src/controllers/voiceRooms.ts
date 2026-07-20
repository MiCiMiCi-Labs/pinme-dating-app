import crypto from 'crypto';
import { AccessToken } from 'livekit-server-sdk';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { getBlockedUserIds, hasBlockBetween } from '../lib/safety';

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

function firstParam(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 20);

  if (!Number.isInteger(limit)) {
    return 20;
  }

  return Math.min(Math.max(limit, 1), 50);
}

function parseCursor(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function parseSearch(query: Request['query']) {
  const value = firstParam(query.query) ?? firstParam(query.search);
  return typeof value === 'string' ? value.trim() : '';
}

function parseTags(query: Request['query']) {
  const raw = firstParam(query.tags) ?? firstParam(query.tag);
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  return raw
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => allowedTags.has(tag));
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

// Participants who are blocked-with the viewer (either direction) must never
// appear in what's sent back — not in the list, and not folded into
// participantCount either, so the count always matches what's actually shown.
function serializeRoom(room: any, blockedUserIds: Set<string> = new Set()) {
  const visibleParticipants = room.participants.filter(
    (participant: any) => !blockedUserIds.has(participant.userId)
  );

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
    participantCount: visibleParticipants.length,
    participants: visibleParticipants.map((participant: any) => ({
      id: participant.id,
      userId: participant.userId,
      isMutedByHost: participant.isMutedByHost,
      joinedAt: participant.joinedAt,
      user: participant.user,
    })),
  };
}

type VoiceRoomListRow = {
  id: string;
  owner_id: string;
  name: string;
  tags: string[];
  livekit_room_name: string;
  is_open: boolean;
  created_at: Date;
  closed_at: Date | null;
  owner_name: string;
  owner_photo_id: string | null;
  owner_photo_url: string | null;
  owner_photo_thumbnail_url: string | null;
  owner_photo_is_primary: boolean | null;
  owner_photo_is_verified: boolean | null;
  owner_photo_order_index: number | null;
  participant_count: number;
};

function serializeRoomListRow(row: VoiceRoomListRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    tags: row.tags,
    livekitRoomName: row.livekit_room_name,
    isOpen: row.is_open,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      photos: row.owner_photo_id
        ? [{
            id: row.owner_photo_id,
            url: row.owner_photo_url,
            thumbnailUrl: row.owner_photo_thumbnail_url,
            isPrimary: row.owner_photo_is_primary ?? false,
            isVerified: row.owner_photo_is_verified ?? false,
            orderIndex: row.owner_photo_order_index ?? 0,
          }]
        : [],
    },
    participantCount: row.participant_count,
    participants: [],
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
    const currentUser = await resolveDbUser(req.userId!);
    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const search = parseSearch(req.query);
    const tags = parseTags(req.query);
    // One batched query for all of the viewer's block relationships, reused
    // both to exclude blocked owners' rooms and to filter each room's
    // participant list below — avoids an hasBlockBetween call per row.
    const blockedUserIds = await getBlockedUserIds(currentUser.id);

    const blockedIds = Array.from(blockedUserIds);
    const tagFilter = tags.length ? tags : null;
    const searchFilter = search || null;
    const rooms = await prisma.$queryRaw<VoiceRoomListRow[]>`
      SELECT
        vr.id,
        vr.owner_id,
        vr.name,
        vr.tags,
        vr.livekit_room_name,
        vr.is_open,
        vr.created_at,
        vr.closed_at,
        owner.name AS owner_name,
        owner_photo.id AS owner_photo_id,
        owner_photo.url AS owner_photo_url,
        owner_photo.thumbnail_url AS owner_photo_thumbnail_url,
        owner_photo.is_primary AS owner_photo_is_primary,
        owner_photo.is_verified AS owner_photo_is_verified,
        owner_photo.order_index AS owner_photo_order_index,
        COALESCE(participants.participant_count, 0)::int AS participant_count
      FROM voice_rooms vr
      JOIN users owner ON owner.id = vr.owner_id
      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.url,
          p.thumbnail_url,
          p.is_primary,
          p.is_verified,
          p.order_index
        FROM photos p
        WHERE p.user_id = owner.id
        ORDER BY p.is_primary DESC, p.order_index ASC, p.created_at ASC
        LIMIT 1
      ) owner_photo ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS participant_count
        FROM voice_room_participants vrp
        WHERE vrp.room_id = vr.id
          AND vrp.left_at IS NULL
          AND NOT (vrp.user_id = ANY(${blockedIds}::text[]))
      ) participants ON true
      WHERE vr.is_open = true
        AND NOT (vr.owner_id = ANY(${blockedIds}::text[]))
        AND (${cursor}::timestamp IS NULL OR vr.created_at < ${cursor})
        AND (${tagFilter}::text[] IS NULL OR vr.tags && ${tagFilter}::text[])
        AND (${searchFilter}::text IS NULL OR vr.id ILIKE '%' || ${searchFilter} || '%' OR vr.name ILIKE '%' || ${searchFilter} || '%')
      ORDER BY vr.created_at DESC
      LIMIT ${limit + 1};
    `;

    const hasMore = rooms.length > limit;
    const pageRooms = rooms.slice(0, limit);
    const lastRoom = pageRooms[pageRooms.length - 1];

    res.json({
      rooms: pageRooms.map(serializeRoomListRow),
      nextCursor: hasMore && lastRoom ? lastRoom.created_at.toISOString() : null,
      hasMore,
    });
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

    const currentUser = await resolveDbUser(req.userId!);
    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
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

    // A block with the owner hides the room entirely — 404, not 403, so its
    // existence isn't leaked to either side of the block.
    if (await hasBlockBetween(currentUser.id, room.ownerId)) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    const blockedUserIds = await getBlockedUserIds(currentUser.id);
    res.json({ room: serializeRoom(room, blockedUserIds) });
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

    // A block with the owner hides the room the same way getVoiceRoom does.
    if (await hasBlockBetween(user.id, room.ownerId)) {
      res.status(404).json({ error: 'Voice room not found' });
      return;
    }

    // Two people who've blocked each other can't share a live audio space —
    // check every currently-active participant (roomInclude already scopes
    // this to leftAt: null) against one batched block-id lookup rather than
    // an hasBlockBetween call per participant. The error is intentionally
    // generic so it doesn't reveal who, specifically, is blocked.
    const blockedUserIds = await getBlockedUserIds(user.id);
    const hasBlockedActiveParticipant = room.participants.some(
      (participant) => participant.userId !== user.id && blockedUserIds.has(participant.userId)
    );

    if (hasBlockedActiveParticipant) {
      res.status(409).json({ error: 'Voice room is unavailable' });
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
      room: serializeRoom(updatedRoom, blockedUserIds),
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
