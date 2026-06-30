CREATE TABLE "voice_rooms" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "livekit_room_name" TEXT NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "voice_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "voice_room_participants" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "is_muted_by_host" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "voice_room_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "voice_rooms_livekit_room_name_key" ON "voice_rooms"("livekit_room_name");
CREATE INDEX "voice_rooms_owner_id_idx" ON "voice_rooms"("owner_id");
CREATE INDEX "voice_rooms_is_open_created_at_idx" ON "voice_rooms"("is_open", "created_at");
CREATE UNIQUE INDEX "voice_room_participants_room_id_user_id_key" ON "voice_room_participants"("room_id", "user_id");
CREATE INDEX "voice_room_participants_user_id_idx" ON "voice_room_participants"("user_id");

ALTER TABLE "voice_rooms" ADD CONSTRAINT "voice_rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_room_participants" ADD CONSTRAINT "voice_room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "voice_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_room_participants" ADD CONSTRAINT "voice_room_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
