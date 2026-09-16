# web — CorruptionFix Next.js app

The Next.js 15 (App Router, TypeScript) application: UI, API routes, and the
Drizzle ORM schema/migrations. Setup, environment variables, and the script
table live in the [repository README](../README.md); deployment lives in
[DEPLOY.md](../DEPLOY.md). This file covers what is specific to `web/`.

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL + SESSION_SECRET at minimum
pnpm db:migrate
pnpm dev                  # http://localhost:3000
```

Node 22+ is required (CI and `Dockerfile` both use 24) — `ai@7` and the
`@ai-sdk/*` packages declare `engines.node >=22`. pnpm is the supported
package manager; its version is pinned by the `packageManager` field in
`package.json`, so `corepack enable` gives you the matching one. Settings
that pnpm needs — notably which dependencies may run install scripts — live
in `pnpm-workspace.yaml`, since pnpm 11+ ignores a `pnpm` key in
`package.json`.

## Layout

| path | what |
|---|---|
| `src/app/` | routes — pages and API route handlers |
| `src/components/` | client components (map, chat, add-office) |
| `src/lib/` | business logic, kept out of route handlers so routes stay thin |
| `src/db/` | Drizzle schema, connection pool, PostGIS column type |
| `drizzle/` | generated SQL migrations + `meta/_journal.json` |
| `scripts/` | `migrate.mjs` (used by CI), `generate-signing-key.mjs` |
| `public/tiles/offices.pmtiles` | vector tiles, built by `pipeline/04-tiles.sh` |

## Session secret

`SESSION_SECRET` is validated as required in every environment by
`src/lib/env.ts`, but **nothing reads it today**: `src/lib/session.ts` derives
a session id as `sha256(32 random bytes)`, which needs no server-side secret.
It is kept required so a deployment can't be stood up without one. Keying that
digest with it (HMAC instead of a bare digest) would invalidate every live
session on the deploy that did so, which is why it hasn't been done silently.

## Database roles

Reporter identity (email/phone) is stored encrypted in the `identity_vault`
schema (`identity_vault.reporter_identities`,
`identity_vault.vault_access_log`), isolated from the `public` schema — see
the comment above the schema declaration in `src/db/schema.ts` and
`src/lib/vault.ts`, the only module allowed to query it. The schema is named
`identity_vault` rather than `vault` because Supabase reserves `vault` for its
own secrets extension.

For local development, a single Postgres role (whatever `DATABASE_URL`
connects as) is used for everything, since drizzle-kit's migration/owner role
needs DDL rights the app role shouldn't have anyway. That's fine for a dev
machine but isn't a real security boundary — application code discipline
("only `vault.ts` touches `identity_vault.*`") is a convention, not
enforcement.

For production, `db/roles.sql` defines two least-privilege roles:

- `cf_app` — the main application role. Full CRUD on `public.*`. No grants at
  all on the `identity_vault` schema (not even `USAGE`), so it can't read
  `reporter_identities` even if application code had a bug that tried.
- `cf_vault` — used only by the connection `src/lib/vault.ts` uses in
  production. Full CRUD on `identity_vault.*` only, no access to `public.*`.

Neither role is a superuser or schema owner, so neither can run migrations.

`db/roles.sql` is documentation plus a prod-hardening script — it is **not**
run automatically by `pnpm db:migrate` or wired into the local
`DATABASE_URL` connection. Apply it by hand once against a production database
(after setting real passwords in place of the `CHANGE_ME_*` placeholders). It
uses psql's `\gexec`, so it must be run with `psql`, not a generic SQL client:

```bash
psql "$DATABASE_URL" -f db/roles.sql
```
