import 'dotenv/config';

import sharp from 'sharp';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { BUCKET } from '../lib/storage';

const thumbnailWidth = 720;
const thumbnailQuality = 72;

async function downloadPhoto(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download failed with ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function createThumbnail(input: Buffer) {
  return sharp(input)
    .rotate()
    .resize({ width: thumbnailWidth, withoutEnlargement: true })
    .jpeg({ quality: thumbnailQuality })
    .toBuffer();
}

async function uploadThumbnail(userId: string, photoId: string, thumbnail: Buffer) {
  const storagePath = `${userId}/thumbnails/${photoId}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, thumbnail, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function main() {
  const photos = await prisma.photo.findMany({
    where: { thumbnailUrl: null },
    select: {
      id: true,
      userId: true,
      url: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let successCount = 0;
  let failCount = 0;

  console.log(`[photos] Found ${photos.length} photos without thumbnails.`);

  for (const photo of photos) {
    try {
      const original = await downloadPhoto(photo.url);
      const thumbnail = await createThumbnail(original);
      const thumbnailUrl = await uploadThumbnail(photo.userId, photo.id, thumbnail);

      await prisma.photo.update({
        where: { id: photo.id },
        data: { thumbnailUrl },
      });

      successCount += 1;
      console.log(`[photos] Backfilled thumbnail for ${photo.id}`);
    } catch (error) {
      failCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[photos] Failed to backfill ${photo.id}: ${message}`);
    }
  }

  console.log(`[photos] Done. success=${successCount} failed=${failCount}`);
}

main()
  .catch((error) => {
    console.error('[photos] Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
