import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { BUCKET, MAX_PHOTOS } from '../lib/storage';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function getMyPhotos(req: Request, res: Response) {
  try {
    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const photos = await prisma.photo.findMany({
      where: { userId: dbUserId },
      orderBy: { orderIndex: 'asc' },
    });
    res.json(photos);
  } catch {
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
}

export async function uploadPhoto(req: Request, res: Response) {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const count = await prisma.photo.count({ where: { userId: dbUserId } });
    if (count >= MAX_PHOTOS) {
      res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos allowed` });
      return;
    }

    const photoId = crypto.randomUUID();
    const ext = req.file.mimetype === 'image/jpeg' ? 'jpg' : req.file.mimetype.split('/')[1];
    const storagePath = `${dbUserId}/${photoId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      res.status(500).json({ error: 'Upload failed', detail: uploadError.message });
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    const photo = await prisma.photo.create({
      data: {
        id: photoId,
        userId: dbUserId,
        url: publicUrl,
        orderIndex: count,
        isPrimary: count === 0,
      },
    });

    res.status(201).json(photo);
  } catch (err) {
    console.error('[uploadPhoto] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deletePhoto(req: Request, res: Response) {
  try {
    const photoId = req.params.photoId as string;

    const dbUserId = await resolveDbUserId(req.userId!);
    if (!dbUserId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const photo = await prisma.photo.findFirst({
      where: { id: photoId, userId: dbUserId },
    });

    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    const storagePath = photo.url.split(`/storage/v1/object/public/${BUCKET}/`)[1];
    if (storagePath) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    }

    await prisma.photo.delete({ where: { id: photoId } });

    if (photo.isPrimary) {
      const next = await prisma.photo.findFirst({
        where: { userId: dbUserId },
        orderBy: { orderIndex: 'asc' },
      });
      if (next) {
        await prisma.photo.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
