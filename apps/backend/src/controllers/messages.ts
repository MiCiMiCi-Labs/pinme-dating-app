import { MessageType } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { VOICE_BUCKET } from '../lib/storage';

const sendMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    messageType: z.enum([MessageType.TEXT, MessageType.IMAGE, MessageType.GIF]).default(MessageType.TEXT),
  })
  .strict();

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 50);

  if (!Number.isInteger(limit)) {
    return 50;
  }

  return Math.min(Math.max(limit, 1), 100);
}

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function findAccessibleMatch(matchId: string, userId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      user1Id: true,
      user2Id: true,
      unmatchedAt: true,
    },
  });

  if (!match) {
    return { match: null, status: 404 as const, error: 'Match not found' };
  }

  if (match.user1Id !== userId && match.user2Id !== userId) {
    return { match: null, status: 403 as const, error: 'Forbidden' };
  }

  return { match, status: null, error: null };
}

export async function getMessages(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const limit = parseLimit(req.query.limit);
    const before = typeof req.query.before === 'string' ? req.query.before : null;

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const access = await findAccessibleMatch(matchId, dbUserId);
    if (!access.match) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const messages = await prisma.message.findMany({
      where: {
        matchId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({
      messages: messages.reverse(),
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function sendMessage(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const parsedBody = sendMessageSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({
        error: 'Invalid message payload',
        details: parsedBody.error.flatten().fieldErrors,
      });
      return;
    }

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const access = await findAccessibleMatch(matchId, dbUserId);
    if (!access.match) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    if (access.match.unmatchedAt) {
      res.status(409).json({ error: 'Cannot send messages to an unmatched chat' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        matchId,
        senderId: dbUserId,
        content: parsedBody.data.content,
        messageType: parsedBody.data.messageType,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.status(201).json({ message });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function uploadVoiceMessage(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const access = await findAccessibleMatch(matchId, dbUserId);
    if (!access.match) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    if (access.match.unmatchedAt) {
      res.status(409).json({ error: 'Cannot send messages to an unmatched chat' });
      return;
    }

    const durationSec = req.body.durationSec ? Math.round(Number(req.body.durationSec)) : null;

    const messageId = crypto.randomUUID();
    const storagePath = `${dbUserId}/voice/${messageId}.m4a`;

    const { error: uploadError } = await supabase.storage
      .from(VOICE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({ error: 'Voice upload failed', detail: uploadError.message });
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from(VOICE_BUCKET).getPublicUrl(storagePath);

    const message = await prisma.message.create({
      data: {
        id: messageId,
        matchId,
        senderId: dbUserId,
        content: publicUrl,
        messageType: MessageType.VOICE,
        durationSec: durationSec ?? null,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ message });
  } catch (err) {
    console.error('[uploadVoiceMessage] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function markMessagesRead(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const access = await findAccessibleMatch(matchId, dbUserId);
    if (!access.match) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const result = await prisma.message.updateMany({
      where: {
        matchId,
        senderId: { not: dbUserId },
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    res.json({
      updatedCount: result.count,
    });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
