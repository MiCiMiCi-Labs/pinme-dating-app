import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { hasIsolatedTestDatabase, warnIfTestDatabaseMissing, TEST_RUN_PREFIX } from './testDbGuard';
import { prisma } from '../src/lib/prisma';
import { updateMyPreferences } from '../src/controllers/preferences';
import { updateMyProfile } from '../src/controllers/profiles';
import { syncCurrentUser } from '../src/controllers/auth';
import { createSwipe } from '../src/controllers/swipes';
import { getDiscoveryFeed } from '../src/controllers/discovery';

warnIfTestDatabaseMissing('discoveryPreferences.test');
const describeIfIsolatedDb = hasIsolatedTestDatabase() ? describe : describe.skip;

// Same lightweight fakes as calls.test.ts — these controllers are exercised
// directly, bypassing HTTP + the requireAuth middleware, so req.userId /
// req.authUser are set by hand to whatever each controller actually reads.
function mockRes() {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  res.status = function (code: number) {
    res.statusCode = code;
    return res as Response;
  };
  res.json = function (payload: unknown) {
    res.body = payload;
    return res as Response;
  };
  return res as Response & { statusCode: number; body: any };
}

const createdUserIds: string[] = [];

async function createTestUser(label: string, overrides: { birthday?: Date } = {}) {
  const supabaseAuthId = randomUUID();
  const user = await prisma.user.create({
    data: {
      supabaseAuthId,
      email: `${TEST_RUN_PREFIX}-${randomUUID()}@example.test`,
      name: `FilterTest ${label}`,
      gender: 'NON_BINARY',
      birthday: overrides.birthday ?? new Date('1995-01-01'),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function underAgeBirthday(years: number) {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()));
}

describeIfIsolatedDb('preferences merge-before-validate', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('rejects a partial update that would create an impossible range against the existing row', async () => {
    const user = await createTestUser('range-conflict');
    await prisma.preference.create({ data: { userId: user.id, maxAge: 35 } });

    const req = { authUser: { id: user.supabaseAuthId }, body: { minAge: 50 } } as unknown as Request;
    const res = mockRes();
    await updateMyPreferences(req, res);

    expect(res.statusCode).toBe(400);
    const stored = await prisma.preference.findUnique({ where: { userId: user.id } });
    // The rejected update must not have been saved — minAge stays unset and
    // maxAge stays at its original value rather than landing in a 50-35 state.
    expect(stored?.minAge).toBeNull();
    expect(stored?.maxAge).toBe(35);
  });

  it('accepts a partial update that is consistent with the existing row', async () => {
    const user = await createTestUser('range-ok');
    await prisma.preference.create({ data: { userId: user.id, maxAge: 35 } });

    const req = { authUser: { id: user.supabaseAuthId }, body: { minAge: 25 } } as unknown as Request;
    const res = mockRes();
    await updateMyPreferences(req, res);

    expect(res.statusCode).toBe(200);
    const stored = await prisma.preference.findUnique({ where: { userId: user.id } });
    expect(stored?.minAge).toBe(25);
    expect(stored?.maxAge).toBe(35);
  });

  it('rejects an impossible height range the same way', async () => {
    const user = await createTestUser('height-conflict');
    await prisma.preference.create({ data: { userId: user.id, maxHeight: 160 } });

    const req = { authUser: { id: user.supabaseAuthId }, body: { minHeight: 180 } } as unknown as Request;
    const res = mockRes();
    await updateMyPreferences(req, res);

    expect(res.statusCode).toBe(400);
  });
});

describeIfIsolatedDb('createSwipe respects target discoverability', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('rejects swiping a target who turned discoverability off', async () => {
    const swiper = await createTestUser('swiper-a');
    const target = await createTestUser('hidden-target');
    await prisma.privacySettings.create({ data: { userId: target.id, discoverable: false } });

    const req = {
      userId: swiper.supabaseAuthId,
      body: { targetId: target.id, action: 'LIKE' },
    } as unknown as Request;
    const res = mockRes();
    await createSwipe(req, res);

    expect(res.statusCode).toBe(404);
    const swipe = await prisma.swipe.findUnique({
      where: { swiperId_targetId: { swiperId: swiper.id, targetId: target.id } },
    });
    expect(swipe).toBeNull();
  });

  it('rejects swiping a target with no privacySettings row at all (fail-closed)', async () => {
    const swiper = await createTestUser('swiper-b');
    const target = await createTestUser('no-privacy-row-target');
    // Deliberately no privacySettings row — simulates data loss/corruption.

    const req = {
      userId: swiper.supabaseAuthId,
      body: { targetId: target.id, action: 'LIKE' },
    } as unknown as Request;
    const res = mockRes();
    await createSwipe(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('allows swiping a discoverable target', async () => {
    const swiper = await createTestUser('swiper-c');
    const target = await createTestUser('visible-target');
    await prisma.privacySettings.create({ data: { userId: target.id, discoverable: true } });

    const req = {
      userId: swiper.supabaseAuthId,
      body: { targetId: target.id, action: 'LIKE' },
    } as unknown as Request;
    const res = mockRes();
    await createSwipe(req, res);

    expect(res.statusCode).toBe(201);
  });
});

describeIfIsolatedDb('getDiscoveryFeed excludes hidden/unconfigured profiles', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  async function withProfileAndPhoto(userId: string) {
    await prisma.profile.create({ data: { userId } });
    await prisma.photo.create({ data: { userId, url: 'https://example.test/p.jpg', orderIndex: 0 } });
  }

  it('never returns a target with discoverable=false or a missing privacySettings row', async () => {
    const viewer = await createTestUser('viewer');
    await prisma.privacySettings.create({ data: { userId: viewer.id, discoverable: true } });
    await withProfileAndPhoto(viewer.id);

    const hidden = await createTestUser('feed-hidden');
    await prisma.privacySettings.create({ data: { userId: hidden.id, discoverable: false } });
    await withProfileAndPhoto(hidden.id);

    const noRow = await createTestUser('feed-no-privacy-row');
    await withProfileAndPhoto(noRow.id);

    const visible = await createTestUser('feed-visible');
    await prisma.privacySettings.create({ data: { userId: visible.id, discoverable: true } });
    await withProfileAndPhoto(visible.id);

    const req = { userId: viewer.supabaseAuthId, query: {} } as unknown as Request;
    const res = mockRes();
    await getDiscoveryFeed(req, res);

    expect(res.statusCode).toBe(200);
    const returnedIds = (res.body.users as Array<{ id: string }>).map((u) => u.id);
    expect(returnedIds).not.toContain(hidden.id);
    expect(returnedIds).not.toContain(noRow.id);
    expect(returnedIds).toContain(visible.id);
  });
});

describeIfIsolatedDb('server-side minimum age enforcement', () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('syncCurrentUser rejects creating a new user under 18', async () => {
    const supabaseAuthId = randomUUID();
    const req = {
      authUser: {
        id: supabaseAuthId,
        email: `${TEST_RUN_PREFIX}-${randomUUID()}@example.test`,
        phone: null,
        user_metadata: {},
      },
      body: {
        name: 'Too Young',
        gender: 'FEMALE',
        birthday: underAgeBirthday(16).toISOString().slice(0, 10),
      },
    } as unknown as Request;
    const res = mockRes();
    await syncCurrentUser(req, res);

    expect(res.statusCode).toBe(400);
    const created = await prisma.user.findUnique({ where: { supabaseAuthId } });
    expect(created).toBeNull();
  });

  it('updateMyProfile rejects changing an existing adult profile to an under-18 birthday', async () => {
    const user = await createTestUser('adult-then-minor');

    const req = {
      authUser: { id: user.supabaseAuthId },
      body: { birthday: underAgeBirthday(10).toISOString().slice(0, 10) },
    } as unknown as Request;
    const res = mockRes();
    await updateMyProfile(req, res);

    expect(res.statusCode).toBe(400);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    // Birthday must be untouched, not silently accepted.
    expect(stored?.birthday.getUTCFullYear()).toBe(1995);
  });
});
