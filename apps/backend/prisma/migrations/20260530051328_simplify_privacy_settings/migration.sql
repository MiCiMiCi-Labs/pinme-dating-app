/*
  Warnings:

  - You are about to drop the column `location_visible` on the `privacy_settings` table. All the data in the column will be lost.
  - You are about to drop the column `show_age` on the `privacy_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "privacy_settings" DROP COLUMN "location_visible",
DROP COLUMN "show_age",
ALTER COLUMN "show_distance" SET DEFAULT false,
ALTER COLUMN "show_online_status" SET DEFAULT false;
