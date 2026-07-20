import { MessageType } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { CHAT_MEDIA_BUCKET, VOICE_BUCKET } from '../lib/storage';
import { getBlockBetween } from '../lib/safety';
import { notifyMessageReceived } from '../lib/notifications';

const sendMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    messageType: z.enum([MessageType.TEXT, MessageType.IMAGE, MessageType.GIF]).default(MessageType.TEXT),
    replyToId: z.string().uuid().optional(),
  })
  .strict();

async function resolveReplyToId(
  raw: unknown,
  matchId: string
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (!raw || typeof raw !== 'string') return { ok: true, id: null };
  const msg = await prisma.message.findUnique({
    where: { id: raw },
    select: { matchId: true },
  });
  if (!msg || msg.matchId !== matchId) return { ok: false };
  return { ok: true, id: raw };
}

const replyToInclude = {
  select: {
    id: true,
    content: true,
    messageType: true,
    recalledAt: true,
    sender: { select: { id: true, name: true } },
  },
} as const;

const reactionsInclude = {
  select: { id: true, userId: true, emoji: true },
} as const;

const RECALL_WINDOW_MS = 2 * 60 * 1000;
const ALLOWED_EMOJIS = new Set(['❤️', '😂', '😮', '👍', '👎']);
const DEFAULT_INTIMACY = {
  level: 0,
  label: 'New',
  color: 'white',
  score: 0,
  mutualDays: 0,
  currentStreakDays: 0,
} as const;

function parseDurationSec(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 30);

  if (!Number.isInteger(limit)) {
    return 30;
  }

  return Math.min(Math.max(limit, 1), 100);
}

function parseBefore(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function notifyOtherParticipant(params: {
  match: { id: string; user1Id: string; user2Id: string };
  senderId: string;
  message: {
    id: string;
    content: string;
    messageType: MessageType;
  };
}) {
  const recipientId = params.match.user1Id === params.senderId
    ? params.match.user2Id
    : params.match.user1Id;

  void notifyMessageReceived({
    matchId: params.match.id,
    senderId: params.senderId,
    recipientId,
    messageId: params.message.id,
    messageType: params.message.messageType,
    content: params.message.content,
  }).catch(error => {
    console.warn('[messages] push notification failed:', error);
  });
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

  const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
  const block = await getBlockBetween(userId, otherUserId);
  if (block) {
    return { match: null, status: 403 as const, error: 'Chat is unavailable' };
  }

  return { match, status: null, error: null };
}

export async function getMessages(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const limit = parseLimit(req.query.limit);
    const before = parseBefore(req.query.before);

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
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: replyToInclude,
        reactions: reactionsInclude,
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = messages.length > limit;
    const pageMessages = messages.slice(0, limit);
    const orderedMessages = pageMessages.reverse();
    const nextCursor = hasMore && orderedMessages.length > 0
      ? orderedMessages[0].createdAt.toISOString()
      : null;

    res.json({
      messages: orderedMessages,
      intimacy: DEFAULT_INTIMACY,
      nextCursor,
      hasMore,
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

    const replyResult = await resolveReplyToId(parsedBody.data.replyToId, matchId);
    if (!replyResult.ok) {
      res.status(400).json({ error: 'Invalid replyToId' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        matchId,
        senderId: dbUserId,
        content: parsedBody.data.content,
        messageType: parsedBody.data.messageType,
        replyToId: replyResult.id,
      },
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: replyToInclude,
        reactions: reactionsInclude,
      },
    });

    notifyOtherParticipant({
      match: access.match,
      senderId: dbUserId,
      message,
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

    const durationSec = parseDurationSec(req.body.durationSec);

    const replyResult = await resolveReplyToId(req.body.replyToId, matchId);
    if (!replyResult.ok) {
      res.status(400).json({ error: 'Invalid replyToId' });
      return;
    }

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
        replyToId: replyResult.id,
      },
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: replyToInclude,
        reactions: reactionsInclude,
      },
    });

    notifyOtherParticipant({
      match: access.match,
      senderId: dbUserId,
      message,
    });

    res.status(201).json({ message });
  } catch (err) {
    console.error('[uploadVoiceMessage] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function uploadImageMessage(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No image file provided' });
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

    const replyResult = await resolveReplyToId(req.body.replyToId, matchId);
    if (!replyResult.ok) {
      res.status(400).json({ error: 'Invalid replyToId' });
      return;
    }

    const rawExt = file.mimetype.split('/')[1] ?? 'jpg';
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    const messageId = crypto.randomUUID();
    const storagePath = `${dbUserId}/images/${messageId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadError) {
      res.status(500).json({ error: 'Image upload failed', detail: uploadError.message });
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(storagePath);

    const message = await prisma.message.create({
      data: { id: messageId, matchId, senderId: dbUserId, content: publicUrl, messageType: MessageType.IMAGE, replyToId: replyResult.id },
      include: { sender: { select: { id: true, name: true } }, replyTo: replyToInclude, reactions: reactionsInclude },
    });

    notifyOtherParticipant({
      match: access.match,
      senderId: dbUserId,
      message,
    });

    res.status(201).json({ message });
  } catch (err) {
    console.error('[uploadImageMessage] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function uploadVideoMessage(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No video file provided' });
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

    const durationSec = parseDurationSec(req.body.durationSec);

    const replyResult = await resolveReplyToId(req.body.replyToId, matchId);
    if (!replyResult.ok) {
      res.status(400).json({ error: 'Invalid replyToId' });
      return;
    }

    const ext = file.mimetype === 'video/quicktime' ? 'mov' : 'mp4';
    const messageId = crypto.randomUUID();
    const storagePath = `${dbUserId}/videos/${messageId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadError) {
      res.status(500).json({ error: 'Video upload failed', detail: uploadError.message });
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(storagePath);

    const message = await prisma.message.create({
      data: {
        id: messageId,
        matchId,
        senderId: dbUserId,
        content: publicUrl,
        messageType: MessageType.VIDEO,
        durationSec,
        replyToId: replyResult.id,
      },
      include: { sender: { select: { id: true, name: true } }, replyTo: replyToInclude, reactions: reactionsInclude },
    });

    notifyOtherParticipant({
      match: access.match,
      senderId: dbUserId,
      message,
    });

    res.status(201).json({ message });
  } catch (err) {
    console.error('[uploadVideoMessage] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function recallMessage(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const messageId = req.params.messageId as string;

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

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { senderId: true, matchId: true, createdAt: true, recalledAt: true },
    });

    if (!msg || msg.matchId !== matchId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (msg.senderId !== dbUserId) {
      res.status(403).json({ error: 'Cannot recall someone else\'s message' });
      return;
    }

    if (msg.recalledAt) {
      res.status(409).json({ error: 'Message already recalled' });
      return;
    }

    if (Date.now() - msg.createdAt.getTime() > RECALL_WINDOW_MS) {
      res.status(409).json({ error: 'Recall window has expired' });
      return;
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { recalledAt: new Date() },
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: replyToInclude,
        reactions: reactionsInclude,
      },
    });

    res.json({ message: updated });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function toggleReaction(req: Request, res: Response) {
  try {
    const matchId = req.params.matchId as string;
    const messageId = req.params.messageId as string;
    const { emoji } = req.body;

    if (typeof emoji !== 'string' || !ALLOWED_EMOJIS.has(emoji)) {
      res.status(400).json({ error: 'Invalid emoji' });
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

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { matchId: true, recalledAt: true },
    });

    if (!msg || msg.matchId !== matchId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (msg.recalledAt) {
      res.status(409).json({ error: 'Cannot react to a recalled message' });
      return;
    }

    const existing = await prisma.messageReaction.findUnique({
      where: { messageId_userId: { messageId, userId: dbUserId } },
    });

    if (existing) {
      if (existing.emoji === emoji) {
        await prisma.messageReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
      }
    } else {
      await prisma.messageReaction.create({
        data: { id: crypto.randomUUID(), messageId, userId: dbUserId, emoji },
      });
    }

    const updated = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: replyToInclude,
        reactions: reactionsInclude,
      },
    });

    res.json({ message: updated });
  } catch {
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
        isRead: false,
        // senderId: { not: dbUserId } alone excludes NULL (SYSTEM messages,
        // e.g. call-outcome records — see recordCallOutcomeMessage) since SQL
        // NULL <> value is neither true nor false. OR senderId: null pulls
        // those back in; own messages (senderId === dbUserId) stay excluded.
        OR: [{ senderId: { not: dbUserId } }, { senderId: null }],
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
