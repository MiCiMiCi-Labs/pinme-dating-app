-- Gate Review fix: Calls Realtime lacked participant-level authorization.
--
-- Without RLS, Supabase Realtime broadcasts postgres_changes payloads for a
-- table to every subscriber whose channel filter matches, with NO per-row
-- authorization check — the client-supplied `caller_id=eq.<id>` /
-- `callee_id=eq.<id>` filter used by the mobile CallProvider is just a
-- subscription convenience, not a security boundary, and the backend's REST
-- authorization (GET /api/v1/calls/:id returning 404 for non-participants)
-- cannot protect a payload Realtime sends directly over the websocket.
-- See docs/private-voice-calling-spec.md "前台实时信令" /
-- "无论使用哪种方案：...方案 B：对 Call 表使用 Postgres Changes + 严格 RLS".
--
-- The backend's own Postgres role (`postgres`, used by Prisma via
-- DATABASE_URL/DIRECT_URL) has the BYPASSRLS attribute in this Supabase
-- project (confirmed via `SELECT rolbypassrls FROM pg_roles WHERE rolname =
-- current_user`), so none of this affects backend reads/writes.
--
-- This is a new migration rather than an edit to
-- 20260716020000_prepare_calls_realtime because that migration has already
-- been applied (recorded in _prisma_migrations with a checksum) — editing
-- an already-applied migration file breaks `prisma migrate deploy`
-- integrity checks for any environment that already ran it.

ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;

-- Realtime's per-subscriber authorization check (and PostgREST, if this
-- table is ever queried directly by a client) runs as `authenticated`.
-- Without this base table grant, RLS would additionally block *everyone*,
-- including legitimate participants — not just non-participants — because
-- `authenticated` currently has zero grants on this table. Intentionally
-- SELECT only: all writes to `calls` go through the backend API (via the
-- `postgres` role), never directly from a client.
GRANT SELECT ON "calls" TO authenticated;

-- Maps the calling `authenticated` role's JWT (auth.uid()) to our internal
-- users.id without granting `authenticated` any privilege on the `users`
-- table itself — SECURITY DEFINER runs as the function owner (postgres,
-- which bypasses RLS), so the lookup succeeds regardless of what grants the
-- caller has on `users`. Scoped to this one lookup rather than opening up
-- `users` more broadly, which is out of scope for this fix.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT "id" FROM "users" WHERE "supabaseAuthId" = auth.uid()::text LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

DROP POLICY IF EXISTS "calls_select_participants" ON "calls";

CREATE POLICY "calls_select_participants"
ON "calls"
FOR SELECT
TO authenticated
USING (
  "caller_id" = public.current_app_user_id()
  OR "callee_id" = public.current_app_user_id()
);
