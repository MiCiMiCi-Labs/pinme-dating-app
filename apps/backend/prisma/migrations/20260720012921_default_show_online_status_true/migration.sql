-- AlterTable
ALTER TABLE "privacy_settings" ALTER COLUMN "show_online_status" SET DEFAULT true;

-- Backfill: no UI ever existed to let a user deliberately choose "false" here
-- (see the Messages screen online-status gate work), so every existing row's
-- false is just an unintended artifact of the old default, not a real user
-- choice. Reset everyone to the new default; anyone can flip it off going
-- forward via the "show online status" toggle in Account settings.
UPDATE "privacy_settings" SET "show_online_status" = true;
