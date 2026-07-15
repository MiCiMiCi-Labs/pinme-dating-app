import { prisma } from './prisma';

export async function hasBlockBetween(userAId: string, userBId: string) {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { id: true },
  });

  return Boolean(block);
}

export async function getBlockBetween(userAId: string, userBId: string) {
  return prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: {
      id: true,
      blockerId: true,
      blockedId: true,
      createdAt: true,
    },
  });
}

// All user ids that are blocked-with (either direction) the given user, in a
// single query. Use this whenever a list endpoint needs to filter many rows
// against one user's block relationships, instead of calling hasBlockBetween
// once per row (N+1).
export async function getBlockedUserIds(userId: string): Promise<Set<string>> {
  const blocks = await prisma.block.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }],
    },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const block of blocks) {
    ids.add(block.blockerId === userId ? block.blockedId : block.blockerId);
  }

  return ids;
}
