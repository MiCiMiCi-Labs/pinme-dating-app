-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "duration_sec" INTEGER;
