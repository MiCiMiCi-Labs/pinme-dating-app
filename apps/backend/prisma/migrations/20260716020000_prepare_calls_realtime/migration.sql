-- Prepare calls for Supabase Realtime subscriptions (mirrors the messages
-- migration 20260530043000_prepare_messages_realtime). The mobile
-- CallProvider subscribes to postgres_changes on this table, filtered by
-- caller_id/callee_id, to detect incoming calls and status changes; the
-- Call row itself (via the REST API) remains the sole source of truth, this
-- is only a delivery/notification hint (see docs/private-voice-calling-spec.md
-- "前台实时信令").
ALTER TABLE "calls" REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "calls";
  END IF;
END $$;
