# Shadow database

`prisma migrate dev` / `migrate diff --create-only` need a scratch Postgres
("shadow database") to replay the full migration history and diff it against
`schema.prisma`. Ours contains two migrations
(`20260716030000_calls_realtime_rls`, `20260716031000_calls_realtime_rls_schema_usage`)
that `GRANT ... TO authenticated` and call `auth.uid()` — objects Supabase
provisions on real projects but that don't exist on a fresh, empty Postgres.
Without them, the shadow database fails to build and those commands error
out with "schema auth does not exist".

This is a local, throwaway Postgres cluster (via `embedded-postgres`) stubbed
with just enough of that Supabase scaffolding — an `auth` schema, a no-op
`auth.uid()`, and empty `authenticated`/`anon`/`service_role` roles — for the
migration history to replay cleanly. It never holds real data and is never
reachable from outside this machine.

## Do you need any of this?

Only if you're going to run `prisma migrate dev` (or `migrate diff
--create-only`) yourself to generate a new migration from a `schema.prisma`
edit. Everything else — running the app, the backend dev server, `prisma
generate`, `prisma validate`, and `prisma migrate deploy` (what actually
applies a migration to the real database) — works exactly as before and
does not need any of this, `SHADOW_DATABASE_URL` set or not. If you'd rather
keep hand-writing `migration.sql` the way this project did before this
existed, that's still fine and works alongside it.

## First-time setup (once per machine)

`.env` is gitignored, so pulling this doesn't bring `SHADOW_DATABASE_URL`
with it — add it to your own `apps/backend/.env`:

```
SHADOW_DATABASE_URL="postgresql://postgres:shadow-db-local-only@127.0.0.1:55432/postgres"
```

Then bootstrap the cluster (downloads a local Postgres 16 into `node_modules`
the first time — no Docker, no system-wide Postgres install needed):

```
npm run shadow-db:bootstrap
```

This applies `bootstrap.sql` to both the `postgres` database (the exact
target `SHADOW_DATABASE_URL` points Prisma at) and `template1` (in case
Prisma ever creates its own throwaway database instead, which would inherit
from `template1`). Safe to re-run.

## Using it

Start it in one terminal and leave it running:

```
npm run shadow-db:start
```

Then, in another terminal, use Prisma as normal:

```
npx prisma migrate dev
npx prisma migrate dev --create-only --name <whatever>
```

Stop it with `npm run shadow-db:stop` (or Ctrl+C the terminal running
`start`) when done — it doesn't need to run outside of active schema work.
