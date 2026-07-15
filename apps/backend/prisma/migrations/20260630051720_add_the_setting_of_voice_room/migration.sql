-- AlterTable
ALTER TABLE "message_reactions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "recalled_at" SET DATA TYPE TIMESTAMP(3);
