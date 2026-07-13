import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizePublicProfile } from '../lib/publicProfile';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

function calculateAge(birthday: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age -= 1;
  }
  return age;
}

async function getEligibleLikerIds(dbUserId: string) {
    const [receivedLikes, mySwipes, blocks, matches] = await Promise.all([
      prisma.swipe.findMany({
        where: {
          targetId: dbUserId,
          action: { in: ['LIKE', 'SUPER_LIKE'] },
        },
        select: {
          swiperId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.swipe.findMany({
        where: { swiperId: dbUserId },
        select: { targetId: true },
      }),
      prisma.block.findMany({
        where: {
          OR: [
            { blockerId: dbUserId },
            { blockedId: dbUserId },
          ],
        },
        select: {
          blockerId: true,
          blockedId: true,
        },
      }),
      prisma.match.findMany({
        where: {
          OR: [
            { user1Id: dbUserId },
            { user2Id: dbUserId },
          ],
          unmatchedAt: null,
        },
        select: {
          user1Id: true,
          user2Id: true,
        },
      }),
    ]);

    const swipedUserIds = new Set(mySwipes.map(swipe => swipe.targetId));
    const blockedUserIds = new Set(
      blocks.map(block => block.blockerId === dbUserId ? block.blockedId : block.blockerId)
    );
    const matchedUserIds = new Set(
      matches.map(match => match.user1Id === dbUserId ? match.user2Id : match.user1Id)
    );

    return receivedLikes
      .map(like => like.swiperId)
      .filter((likerId, index, all) =>
        all.indexOf(likerId) === index &&
        likerId !== dbUserId &&
        !swipedUserIds.has(likerId) &&
        !blockedUserIds.has(likerId) &&
        !matchedUserIds.has(likerId)
      );
}

async function hasActiveSubscription(dbUserId: string) {
  const [subscription] = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM subscriptions
      WHERE user_id = ${dbUserId}
        AND status = 'ACTIVE'::"SubscriptionStatus"
        AND (expires_at IS NULL OR expires_at > NOW())
    ) AS exists
  `);

  return Boolean(subscription?.exists);
}

export async function getLikesPreview(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const eligibleLikerIds = await getEligibleLikerIds(dbUserId);

    const previewPhotos = eligibleLikerIds.length
      ? await prisma.photo.findMany({
          where: {
            userId: { in: eligibleLikerIds.slice(0, 12) },
          },
          orderBy: [
            { isPrimary: 'desc' },
            { orderIndex: 'asc' },
            { createdAt: 'asc' },
          ],
          select: {
            id: true,
            userId: true,
            url: true,
            thumbnailUrl: true,
            isPrimary: true,
          },
        })
      : [];

    const photoByUserId = new Map<string, (typeof previewPhotos)[number]>();
    for (const photo of previewPhotos) {
      if (!photoByUserId.has(photo.userId)) {
        photoByUserId.set(photo.userId, photo);
      }
    }

    const preview = eligibleLikerIds
      .map(userId => {
        const photo = photoByUserId.get(userId);
        if (!photo) return null;
        return {
          userId,
          photoUrl: photo.url,
          thumbnailUrl: photo.thumbnailUrl ?? photo.url,
        };
      })
      .filter((item): item is { userId: string; photoUrl: string; thumbnailUrl: string } => Boolean(item))
      .slice(0, 3);

    res.json({
      count: eligibleLikerIds.length,
      preview,
    });
  } catch (error) {
    console.error('[getLikesPreview] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getLikesList(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isPremium = await hasActiveSubscription(dbUserId);
    if (!isPremium) {
      res.status(402).json({ error: 'Premium subscription required' });
      return;
    }

    const eligibleLikerIds = await getEligibleLikerIds(dbUserId);
    const users = eligibleLikerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: eligibleLikerIds } },
          select: {
            id: true,
            name: true,
            gender: true,
            birthday: true,
            bio: true,
            city: true,
            profile: true,
            photos: {
              orderBy: [{ isPrimary: 'desc' }, { orderIndex: 'asc' }, { createdAt: 'asc' }],
            },
          },
        })
      : [];

    const userById = new Map(users.map(user => [user.id, user]));
    const likedBy = eligibleLikerIds
      .map(userId => userById.get(userId))
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
      .map(({ birthday, profile, ...user }) => ({
        ...user,
        profile: sanitizePublicProfile(profile),
        age: calculateAge(birthday),
      }));

    res.json({ likedBy });
  } catch (error) {
    console.error('[getLikesList] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
