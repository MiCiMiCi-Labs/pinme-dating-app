import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Gender, RelationshipGoal } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

// Every mock account's email carries this prefix so it can always be found
// and wiped again later without touching real accounts — `db:seed` re-runs
// are idempotent (clears its own previous batch first) and `db:seed:clean`
// removes them without reseeding.
const MOCK_EMAIL_PREFIX = 'mockseed-';
const MOCK_COUNT = 30;

// Auckland CBD — matches where the existing real test accounts already set
// their location, so distance-filter testing has a believable center point.
const CENTER = { latitude: -36.8485, longitude: 174.7633 };

// Split by presented gender so a MALE mock user doesn't end up with a
// woman's headshot (the previous version cycled through one ungendered
// Unsplash pool for everyone — the photo, not the `gender` column, was what
// made "select Boys, still see women" look like a real filter bug during
// testing, when the backend query was actually already correct).
// randomuser.me's portrait photos are explicitly split into men/women
// folders, so there's no ambiguity here.
const MALE_PHOTOS = Array.from(
  { length: 10 },
  (_, i) => `https://randomuser.me/api/portraits/men/${i}.jpg`
);
const FEMALE_PHOTOS = Array.from(
  { length: 10 },
  (_, i) => `https://randomuser.me/api/portraits/women/${i}.jpg`
);

function photoPoolForGender(gender: Gender): string[] {
  if (gender === 'MALE') return MALE_PHOTOS;
  if (gender === 'FEMALE') return FEMALE_PHOTOS;
  // Non-binary / self-describe / prefer-not-to-say / other — draw from both.
  return [...MALE_PHOTOS, ...FEMALE_PHOTOS];
}

const FIRST_NAMES = [
  'Ariana', 'Beau', 'Chloe', 'Dax', 'Emi', 'Finn', 'Grace', 'Hana', 'Ivo', 'Jules',
  'Kai', 'Leilani', 'Milo', 'Nova', 'Oskar', 'Priya', 'Quinn', 'Reo', 'Sana', 'Theo',
  'Uma', 'Val', 'Wren', 'Xiu', 'Yara', 'Zane', 'Amara', 'Brix', 'Cleo', 'Dev',
];

const CITIES = [
  { label: 'Auckland CBD, New Zealand', maxKm: 5 },
  { label: 'Ponsonby, New Zealand', maxKm: 5 },
  { label: 'Mount Eden, New Zealand', maxKm: 10 },
  { label: 'North Shore, New Zealand', maxKm: 20 },
  { label: 'Manukau, New Zealand', maxKm: 20 },
  { label: 'Hamilton, New Zealand', maxKm: 50 },
  { label: 'Tauranga, New Zealand', maxKm: 50 },
  { label: 'Wellington, New Zealand', maxKm: 500 },
  { label: 'Sydney, Australia', maxKm: 2500 },
];

const JOB_TITLES = [
  'Product Designer', 'Barista', 'Software Engineer', 'Nurse', 'Photographer',
  'Teacher', 'Chef', 'Marketing Manager', 'Physiotherapist', 'Architect', null,
];

const RELATIONSHIP_GOALS: RelationshipGoal[] = [
  'LONG_TERM', 'SERIOUS_OPEN_TO_SHORT_TERM', 'CASUAL', 'FRIENDSHIP', 'UNDECIDED',
];

// Weighted so Girls/Boys/Non-binary filter testing all have enough candidates,
// with a couple of the rarer enum values thrown in for edge-case coverage.
const GENDER_POOL: Gender[] = [
  ...Array(11).fill('FEMALE' as Gender),
  ...Array(11).fill('MALE' as Gender),
  ...Array(6).fill('NON_BINARY' as Gender),
  'SELF_DESCRIBE',
  'PREFER_NOT_TO_SAY',
];

function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function birthdayForAge(age: number): Date {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), 15));
}

// Offsets CENTER by `distanceKm` in a random direction — good enough for
// realistic-looking test data, not real geodesy.
function offsetLocation(distanceKm: number) {
  const bearing = Math.random() * 2 * Math.PI;
  const latOffset = (distanceKm / 111) * Math.cos(bearing);
  const lngOffset =
    (distanceKm / (111 * Math.cos((CENTER.latitude * Math.PI) / 180))) * Math.sin(bearing);
  return {
    latitude: CENTER.latitude + latOffset,
    longitude: CENTER.longitude + lngOffset,
  };
}

async function clearPreviousMockUsers() {
  const existing = await prisma.user.findMany({
    where: { email: { startsWith: MOCK_EMAIL_PREFIX } },
    select: { id: true },
  });

  if (existing.length === 0) return 0;

  await prisma.user.deleteMany({ where: { id: { in: existing.map((u) => u.id) } } });
  return existing.length;
}

async function seed() {
  const removed = await clearPreviousMockUsers();
  console.log(`[seed] Removed ${removed} mock user(s) from a previous run.`);

  if (process.argv.includes('--clean-only')) {
    return;
  }

  for (let i = 0; i < MOCK_COUNT; i += 1) {
    const name = pick(FIRST_NAMES, i);
    const gender = pick(GENDER_POOL, i + Math.floor(i / FIRST_NAMES.length));
    const age = randomInt(18, 45);
    // ~20% of mock users skip height, so "Any" height filtering has
    // something real to pass through.
    const height = i % 5 === 0 ? null : randomInt(155, 195);
    const city = pick(CITIES, i);
    const jobTitle = pick(JOB_TITLES, i);
    const relationshipGoal = pick(RELATIONSHIP_GOALS, i);

    const user = await prisma.user.create({
      data: {
        supabaseAuthId: randomUUID(),
        email: `${MOCK_EMAIL_PREFIX}${i}-${name.toLowerCase()}@example.test`,
        name,
        gender,
        birthday: birthdayForAge(age),
        city: city.label,
        bio: `Hi, I'm ${name} — mock profile #${i} for local testing.`,
        profile: {
          create: {
            height,
            jobTitle,
            relationshipGoal,
          },
        },
        photos: {
          create: (() => {
            const pool = photoPoolForGender(gender);
            return [0, 1].map((slot) => ({
              url: pick(pool, i + slot),
              thumbnailUrl: pick(pool, i + slot),
              orderIndex: slot,
              isPrimary: slot === 0,
            }));
          })(),
        },
      },
    });

    // ~10% explicitly hidden and ~7% missing the row entirely, to exercise
    // the discoverable=false / missing-privacySettings-row exclusion paths
    // fixed in discovery.ts and swipes.ts. Everyone else is visible.
    if (i % 10 === 0) {
      await prisma.privacySettings.create({
        data: { userId: user.id, discoverable: false, showDistance: false, showOnlineStatus: true },
      });
    } else if (i % 15 === 1) {
      // no privacySettings row at all — leave as-is
    } else {
      await prisma.privacySettings.create({
        data: {
          userId: user.id,
          discoverable: true,
          showDistance: i % 3 !== 0,
          showOnlineStatus: true,
        },
      });
    }

    // ~15% have no location saved at all, matching real accounts that never
    // granted location — exercises the "distance filter can't exclude
    // someone with no location" behavior.
    if (i % 7 !== 0) {
      const distanceKm = randomInt(0, city.maxKm);
      const { latitude, longitude } = offsetLocation(distanceKm);
      await prisma.location.create({
        data: { userId: user.id, latitude, longitude, city: city.label },
      });
    }
  }

  console.log(`[seed] Created ${MOCK_COUNT} mock discovery users.`);
}

seed()
  .catch((error) => {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
