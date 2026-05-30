import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

async function resolveDbUserId(supabaseAuthId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseAuthId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function createReport(req: Request, res: Response) {
  try {
    const reporterId = await resolveDbUserId(req.userId!);
    if (!reporterId) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { reportedId, reason, description } = req.body;

    if (!reportedId || typeof reportedId !== 'string') {
      res.status(400).json({ error: 'reportedId is required' });
      return;
    }

    if (!reason || typeof reason !== 'string') {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    if (reporterId === reportedId) {
      res.status(400).json({ error: 'Cannot report yourself' });
      return;
    }

    const targetExists = await prisma.user.findUnique({
      where: { id: reportedId },
      select: { id: true },
    });
    if (!targetExists) {
      res.status(404).json({ error: 'Reported user not found' });
      return;
    }

    const report = await prisma.report.create({
      data: {
        reporterId,
        reportedId,
        reason,
        description: description ?? null,
      },
    });

    res.status(201).json(report);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
}
