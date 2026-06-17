import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { supabase } from '../lib/supabase';
import { BUCKET, MAX_PHOTOS } from '../lib/storage';
import { checkContentModeration, verifyFacePhoto } from '../lib/rekognition';

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

    const modCheck = await checkContentModeration(req.file.buffer);
    if (!modCheck.passed && modCheck.blockedLabel !== 'service_error') {
      res.status(400).json({ error: 'This photo violates our content policy.' });
      return;
    }

    const isFirstPhoto = count === 0;
    let isVerified = false;
    let verifiedAt: Date | null = null;

    if (isFirstPhoto) {
      const verification = await verifyFacePhoto(req.file.buffer);
      if (!verification.passed && verification.reason !== 'service_error') {
        const reasonMessages: Record<string, string> = {
          no_face: 'Your primary photo must clearly show your face.',
          low_confidence: 'We couldn\'t detect a clear face. Try a better lit photo.',
          low_quality: 'Photo quality is too low. Try a clearer, brighter photo.',
          content_policy: 'This photo doesn\'t meet our content guidelines.',
        };
        res.status(400).json({
          error: reasonMessages[verification.reason ?? ''] ?? 'Primary photo must show a clear face.',
        });
        return;
      }
      isVerified = verification.passed;
      verifiedAt = verification.passed ? new Date() : null;
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
        isPrimary: isFirstPhoto,
        isVerified,
        verifiedAt,
      },
    });

    res.status(201).json(photo);
  } catch (err) {
    console.error('[uploadPhoto] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setPrimaryPhoto(req: Request, res: Response) {
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

    // Verify face before committing the primary change
    const imgRes = await fetch(photo.url);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const verification = await verifyFacePhoto(buffer);

    const verificationFailedMessages: Record<string, string> = {
      no_face: 'Your primary photo must clearly show your face.',
      low_confidence: 'We couldn\'t detect a clear face. Try a better lit photo.',
      low_quality: 'Photo quality is too low. Try a clearer, brighter photo.',
      content_policy: 'This photo doesn\'t meet our content guidelines.',
    };

    // Block on face/content failures — allow through on service errors (AWS down)
    if (!verification.passed && verification.reason !== 'service_error') {
      res.status(400).json({
        error: verificationFailedMessages[verification.reason ?? ''] ?? 'Primary photo must show a clear face.',
      });
      return;
    }

    await prisma.$transaction([
      prisma.photo.updateMany({ where: { userId: dbUserId }, data: { isPrimary: false } }),
      prisma.photo.update({
        where: { id: photoId },
        data: {
          isPrimary: true,
          isVerified: verification.passed,
          verifiedAt: verification.passed ? new Date() : null,
        },
      }),
    ]);

    const updated = await prisma.photo.findUnique({ where: { id: photoId } });
    res.json(updated);
  } catch {
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
