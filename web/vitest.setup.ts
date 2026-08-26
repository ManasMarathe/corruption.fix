// Test-only env bootstrap. src/lib/env.ts fails fast if DATABASE_URL or
// SESSION_SECRET are missing (they're required in every environment, not
// just production), so unit tests that transitively import env.ts (e.g.
// via crypto.ts, otp.ts) need placeholder values even though no test here
// opens a real Postgres connection — DATABASE_URL is only used lazily, when
// a query actually runs. The vault/session secrets are left unset so
// env.ts's own dev-fallback warning path is exercised, matching local dev.
process.env.DATABASE_URL ??= "postgres://localhost:5432/corruptionfix_test";
process.env.SESSION_SECRET ??= "test-session-secret-do-not-use-in-production";
