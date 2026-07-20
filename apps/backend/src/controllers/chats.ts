import { Request, Response } from 'express';
import { calculateAge } from '../lib/age';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

const defaultChatIntimacy = {
  level: 0,
  label: 'New',
  color: 'white',
  score: 0,
  mutualDays: 0,
  currentStreakDays: 0,
};

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 20);

  if (!Number.isInteger(limit)) {
    return 20;
  }

  return Math.min(Math.max(limit, 1), 50);
}

type ChatListRow = {
  match_id: string;
  match_created_at: Date;
  user_id: string;
  name: string;
  gender: string;
  birthday: Date;
  city: string | null;
  photo_id: string | null;
  photo_url: string | null;
  photo_thumbnail_url: string | null;
  photo_is_primary: boolean | null;
  photo_is_verified: boolean | null;
  photo_order_index: number | null;
  last_message_id: string | null;
  last_message_sender_id: string | null;
  last_message_content: string | null;
  last_message_type: string | null;
  last_message_duration_sec: number | null;
  last_message_is_read: boolean | null;
  last_message_recalled_at: Date | null;
  last_message_created_at: Date | null;
  sender_id: string | null;
  sender_name: string | null;
  unread_count: number;
  is_online: boolean;
};

export async function getChats(req: Request, res: Response) {
  try {
    const limit = parseLimit(req.query.limit);
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const rows = await prisma.$queryRaw<ChatListRow[]>`
      SELECT
        m.id AS match_id,
        m.created_at AS match_created_at,
        other_user.id AS user_id,
        other_user.name,
        other_user.gender::text AS gender,
        other_user.birthday,
        other_user.city,
        primary_photo.id AS photo_id,
        primary_photo.url AS photo_url,
        primary_photo.thumbnail_url AS photo_thumbnail_url,
        primary_photo.is_primary AS photo_is_primary,
        primary_photo.is_verified AS photo_is_verified,
        primary_photo.order_index AS photo_order_index,
        last_message.id AS last_message_id,
        last_message.sender_id AS last_message_sender_id,
        last_message.content AS last_message_content,
        last_message.message_type::text AS last_message_type,
        last_message.duration_sec AS last_message_duration_sec,
        last_message.is_read AS last_message_is_read,
        last_message.recalled_at AS last_message_recalled_at,
        last_message.created_at AS last_message_created_at,
        sender.id AS sender_id,
        sender.name AS sender_name,
        COALESCE(unread.unread_count, 0)::int AS unread_count,
        -- 2 minutes: matches the mobile heartbeat ping interval (see
        -- apps/mobile's root-layout heartbeat hook) with slack for a couple
        -- of missed/delayed pings before falling back to "offline". Also
        -- respects the other user's showOnlineStatus privacy toggle.
        COALESCE(
          COALESCE(other_privacy.show_online_status, false)
            AND other_user.last_active_at > NOW() - INTERVAL '2 minutes',
          false
        ) AS is_online
      FROM matches m
      JOIN users other_user
        ON other_user.id = CASE
          WHEN m.user1_id = ${dbUserId} THEN m.user2_id
          ELSE m.user1_id
        END
      LEFT JOIN privacy_settings other_privacy ON other_privacy.user_id = other_user.id
      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.url,
          p.thumbnail_url,
          p.is_primary,
          p.is_verified,
          p.order_index
        FROM photos p
        WHERE p.user_id = other_user.id
        ORDER BY p.is_primary DESC, p.order_index ASC, p.created_at ASC
        LIMIT 1
      ) primary_photo ON true
      LEFT JOIN LATERAL (
        SELECT
          msg.id,
          msg.sender_id,
          msg.content,
          msg.message_type,
          msg.duration_sec,
          msg.is_read,
          msg.recalled_at,
          msg.created_at
        FROM messages msg
        WHERE msg.match_id = m.id
        ORDER BY msg.created_at DESC
        LIMIT 1
      ) last_message ON true
      LEFT JOIN users sender ON sender.id = last_message.sender_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM messages unread_msg
        WHERE unread_msg.match_id = m.id
          AND unread_msg.sender_id IS DISTINCT FROM ${dbUserId}
          AND unread_msg.is_read = false
      ) unread ON true
      WHERE m.unmatched_at IS NULL
        AND (m.user1_id = ${dbUserId} OR m.user2_id = ${dbUserId})
      ORDER BY COALESCE(last_message.created_at, m.created_at) DESC
      LIMIT ${limit};
    `;

    const result = rows.map(row => ({
      matchId: row.match_id,
      createdAt: row.match_created_at,
      lastMessage: row.last_message_id
        ? {
            id: row.last_message_id,
            matchId: row.match_id,
            senderId: row.last_message_sender_id,
            content: row.last_message_content ?? '',
            messageType: row.last_message_type,
            durationSec: row.last_message_duration_sec,
            isRead: row.last_message_is_read ?? false,
            recalledAt: row.last_message_recalled_at,
            reactions: [],
            createdAt: row.last_message_created_at,
            sender: row.sender_id ? { id: row.sender_id, name: row.sender_name ?? '' } : null,
            replyTo: null,
          }
        : null,
      unreadCount: row.unread_count,
      intimacy: defaultChatIntimacy,
      user: {
        id: row.user_id,
        name: row.name,
        gender: row.gender,
        bio: null,
        city: row.city,
        age: calculateAge(row.birthday),
        isOnline: row.is_online,
        photos: row.photo_id
          ? [{
              id: row.photo_id,
              url: row.photo_url,
              thumbnailUrl: row.photo_thumbnail_url,
              isPrimary: row.photo_is_primary ?? false,
              isVerified: row.photo_is_verified ?? false,
              orderIndex: row.photo_order_index ?? 0,
            }]
          : [],
      },
    }));

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
