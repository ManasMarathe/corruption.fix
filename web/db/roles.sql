-- Database roles for CorruptionFix (prod hardening; documentation for v1).
--
-- This is NOT run automatically anywhere yet. It is not wired into local
-- dev (which connects as a single superuser/owner role via DATABASE_URL)
-- and it is not applied by drizzle-kit migrations, which only manage
-- table/schema DDL. Apply by hand against the target database when setting
-- up a production Postgres instance:
--
--   psql "$DATABASE_URL" -f db/roles.sql
--
-- Rationale (see the schema comment above `identity_vault` in src/db/schema.ts):
-- reporter contact info (email/phone) lives in the `identity_vault` schema,
-- encrypted and HMAC-indexed, deliberately isolated from `public` so that a
-- credential compromise of the main application path can't read plaintext
-- contact info. That isolation is only real if the *database role* the app
-- normally connects as cannot even read `identity_vault.*` tables — schema-level
-- code discipline (e.g. "only src/lib/vault.ts touches vault.*") is a
-- convention, not a security boundary, without this.
--
-- Two roles:
--   cf_app   — used by the main Next.js app for everything EXCEPT the
--              vault-touching code path. No privileges on the `identity_vault`
--              schema at all (not even USAGE), so it cannot even see that
--              identity_vault.* tables exist, let alone query them.
--   cf_vault — used only by the code path in src/lib/vault.ts (in
--              production this would be a separate connection pool /
--              credential from the one used for `db` in src/db/index.ts).
--              Has access to `identity_vault.*` and, for FK-free correlation via
--              application code, no special public-schema grants beyond
--              what's needed to open a connection.
--
-- Both are intentionally NOT superusers and NOT the schema owner, so
-- neither can run DDL (CREATE/ALTER/DROP) — that's reserved for a
-- migration/owner role (e.g. the one drizzle-kit migrate connects as).

-- --- cf_app: public schema only, no identity_vault access -----------------------

CREATE ROLE cf_app LOGIN PASSWORD 'CHANGE_ME_cf_app';
COMMENT ON ROLE cf_app IS
  'Main application role. Full CRUD on public.* tables. Deliberately has '
  'no grants at all on the identity_vault schema — cannot read reporter_identities '
  'or vault_access_log, even indirectly, since it lacks USAGE on the schema.';

GRANT CONNECT ON DATABASE current_database() TO cf_app;
GRANT USAGE ON SCHEMA public TO cf_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cf_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cf_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cf_app;

-- Explicitly deny (default-deny already applies since no GRANT was made,
-- this just documents the intent for anyone reading the role's grants).
REVOKE ALL ON SCHEMA identity_vault FROM cf_app;

-- --- cf_vault: identity_vault schema only ----------------------------------------

CREATE ROLE cf_vault LOGIN PASSWORD 'CHANGE_ME_cf_vault';
COMMENT ON ROLE cf_vault IS
  'Identity-vault role. Used exclusively by the src/lib/vault.ts code '
  'path (a separate DB connection/credential from the main app pool in '
  'production). Full CRUD on identity_vault.* only.';

GRANT CONNECT ON DATABASE current_database() TO cf_vault;
GRANT USAGE ON SCHEMA identity_vault TO cf_vault;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity_vault TO cf_vault;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA identity_vault TO cf_vault;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity_vault
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cf_vault;
ALTER DEFAULT PRIVILEGES IN SCHEMA identity_vault
  GRANT USAGE, SELECT ON SEQUENCES TO cf_vault;

REVOKE ALL ON SCHEMA public FROM cf_vault;
