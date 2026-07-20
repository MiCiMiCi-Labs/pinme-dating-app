import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

const PROMO_CODES = new Map<string, { plan: string; days: number }>([
  ['PINMEPLUS', { plan: 'premium', days: 30 }],
  ['TESTMATCH', { plan: 'premium', days: 30 }],
  ['CICI2026', { plan: 'premium', days: 90 }],
  ['PINMEVIP', { plan: 'premium', days: 365 }],
]);

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

type DbSubscription = {
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELED';
  plan: string;
  source: string;
  promoCode: string | null;
  expiresAt: Date | null;
};

type SubscriptionRow = {
  userId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELED' | null;
  plan: string | null;
  source: string | null;
  promoCode: string | null;
  expiresAt: Date | null;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function serializeSubscription(
  subscription: {
    status: 'ACTIVE' | 'EXPIRED' | 'CANCELED';
    plan: string;
    source: string;
    promoCode: string | null;
    expiresAt: Date | null;
  } | null
) {
  if (!subscription) {
    return {
      status: 'EXPIRED' as const,
      plan: null,
      source: null,
      promoCode: null,
      expiresAt: null,
      isActive: false,
    };
  }

  const isActive =
    subscription.status === 'ACTIVE' &&
    (!subscription.expiresAt || subscription.expiresAt.getTime() > Date.now());

  return {
    ...subscription,
    expiresAt: subscription.expiresAt?.toISOString() ?? null,
    isActive,
  };
}

export async function getMySubscription(req: Request, res: Response) {
  try {
    const [row] = await prisma.$queryRaw<SubscriptionRow[]>(Prisma.sql`
      SELECT
        u.id AS "userId",
        s.status,
        s.plan,
        s.source,
        s.promo_code AS "promoCode",
        s.expires_at AS "expiresAt"
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE u."supabaseAuthId" = ${req.userId!}
      LIMIT 1
    `);

    if (!row) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      subscription: serializeSubscription(row.status && row.plan && row.source
        ? {
            status: row.status,
            plan: row.plan,
            source: row.source,
            promoCode: row.promoCode,
            expiresAt: row.expiresAt,
          }
        : null),
    });
  } catch (error) {
    console.error('[getMySubscription] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function redeemPromoCode(req: Request, res: Response) {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const promo = PROMO_CODES.get(code);

    if (!promo) {
      res.status(400).json({ error: 'Invalid promo code' });
      return;
    }

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const expiresAt = addDays(new Date(), promo.days);
    const [subscription] = await prisma.$queryRaw<DbSubscription[]>(Prisma.sql`
      INSERT INTO subscriptions (
        id,
        user_id,
        status,
        plan,
        source,
        promo_code,
        expires_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${dbUserId},
        'ACTIVE'::"SubscriptionStatus",
        ${promo.plan},
        'promo',
        ${code},
        ${expiresAt},
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'ACTIVE'::"SubscriptionStatus",
        plan = EXCLUDED.plan,
        source = EXCLUDED.source,
        promo_code = EXCLUDED.promo_code,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
      RETURNING
        status,
        plan,
        source,
        promo_code AS "promoCode",
        expires_at AS "expiresAt"
    `);

    res.json({
      message: 'Promo code applied',
      subscription: serializeSubscription(subscription ?? null),
    });
  } catch (error) {
    console.error('[redeemPromoCode] error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
