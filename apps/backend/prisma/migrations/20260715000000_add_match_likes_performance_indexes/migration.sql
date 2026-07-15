CREATE INDEX IF NOT EXISTS "photos_user_id_is_primary_order_index_created_at_idx"
  ON "photos" ("user_id", "is_primary", "order_index", "created_at");

CREATE INDEX IF NOT EXISTS "swipes_target_id_action_created_at_idx"
  ON "swipes" ("target_id", "action", "created_at");

CREATE INDEX IF NOT EXISTS "matches_user2_id_user1_id_idx"
  ON "matches" ("user2_id", "user1_id");

CREATE INDEX IF NOT EXISTS "messages_match_id_is_read_sender_id_idx"
  ON "messages" ("match_id", "is_read", "sender_id");

CREATE INDEX IF NOT EXISTS "blocks_blocked_id_blocker_id_idx"
  ON "blocks" ("blocked_id", "blocker_id");
