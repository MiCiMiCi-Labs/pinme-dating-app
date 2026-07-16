-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'MISSED', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "ApnsEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "call_id" TEXT;

-- CreateTable
CREATE TABLE "call_preferences" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "audio_enabled" BOOLEAN NOT NULL DEFAULT false,
    "video_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_invited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "caller_id" TEXT NOT NULL,
    "callee_id" TEXT NOT NULL,
    "type" "CallType" NOT NULL DEFAULT 'AUDIO',
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "room_name" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by_id" TEXT,
    "duration_sec" INTEGER,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voip_device_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "environment" "ApnsEnvironment" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voip_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_preferences_user_id_idx" ON "call_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_preferences_match_id_user_id_key" ON "call_preferences"("match_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calls_room_name_key" ON "calls"("room_name");

-- CreateIndex
CREATE INDEX "calls_match_id_created_at_idx" ON "calls"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "calls_caller_id_status_idx" ON "calls"("caller_id", "status");

-- CreateIndex
CREATE INDEX "calls_callee_id_status_idx" ON "calls"("callee_id", "status");

-- CreateIndex
CREATE INDEX "calls_status_expires_at_idx" ON "calls"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "voip_device_tokens_token_key" ON "voip_device_tokens"("token");

-- CreateIndex
CREATE INDEX "voip_device_tokens_user_id_idx" ON "voip_device_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_call_id_key" ON "messages"("call_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_preferences" ADD CONSTRAINT "call_preferences_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_preferences" ADD CONSTRAINT "call_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_fkey" FOREIGN KEY ("callee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voip_device_tokens" ADD CONSTRAINT "voip_device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one active (RINGING/ACCEPTED) call per match.
-- Not expressible in the Prisma schema DSL (no partial index syntax), so it
-- is hand-maintained here. The cross-match "one active call per user"
-- invariant is enforced in application code via a serializable transaction
-- (see src/lib/calls.ts) since it spans two columns (caller_id/callee_id).
CREATE UNIQUE INDEX "calls_match_id_active_unique" ON "calls"("match_id") WHERE "status" IN ('RINGING', 'ACCEPTED');

