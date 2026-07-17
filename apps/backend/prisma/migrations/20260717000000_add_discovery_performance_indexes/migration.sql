CREATE INDEX "users_created_at_id_idx" ON "users"("created_at", "id");
CREATE INDEX "users_gender_birthday_created_at_id_idx" ON "users"("gender", "birthday", "created_at", "id");
CREATE INDEX "profiles_height_user_id_idx" ON "profiles"("height", "user_id");
CREATE INDEX "privacy_settings_discoverable_user_id_idx" ON "privacy_settings"("discoverable", "user_id");
CREATE INDEX "swipes_swiper_id_idx" ON "swipes"("swiper_id");
CREATE INDEX "blocks_blocker_id_idx" ON "blocks"("blocker_id");
