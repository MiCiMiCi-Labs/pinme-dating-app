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
