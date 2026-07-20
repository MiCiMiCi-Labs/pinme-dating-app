-- Stubs just enough of Supabase's platform-provisioned schema/roles for
-- Prisma's migration history to replay cleanly on a plain Postgres cluster.
-- Real Supabase projects get these for free; a bare Postgres (like this one)
-- does not. See shadow-db/README.md.
--
-- Applied (by manage.mjs) to both the "postgres" database directly — the
-- exact target Prisma connects to via SHADOW_DATABASE_URL — and to
-- template1, so it's also inherited by any throwaway database Prisma might
-- create on its own.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULL::uuid $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;
