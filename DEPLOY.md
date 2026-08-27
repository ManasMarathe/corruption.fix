# Deploying CorruptionFix (Vercel + Supabase)

Production topology:

- **Vercel** — hosts `web/` (Next.js, ISR office pages, all API routes).
- **Supabase** — Postgres 16 + PostGIS. The app connects through the
  **transaction-mode pooler** (port `6543`); migrations and the seed
  pipeline connect through the **session-mode pooler** (port `5432`).
- **Resend** — OTP verification emails.
- **GitHub Actions** — `.github/workflows/jobs.yml` hits `/api/jobs/*`
  every 30 minutes (stats refresh, checkpoint signing, thresholds).

Map tiles need no separate infrastructure: `web/public/tiles/offices.pmtiles`
(~1.5 MB) deploys with the app, and the basemap is served by
`tiles.openfreemap.org` (already CSP-allowlisted in `web/next.config.ts`).

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard> — pick the
   **Mumbai (ap-south-1)** region.
2. From **Connect** on the project dashboard, note the two pooler URLs:
   - Session pooler (port `5432`) — call it `$SESSION_URL`. Used from your
     machine for migrations + seeding.
   - Transaction pooler (port `6543`) — call it `$POOL_URL`. This becomes
     `DATABASE_URL` on Vercel. (`web/src/db/index.ts` already sets
     `prepare: false`, which transaction mode requires.)
3. No manual PostGIS step needed — the first migration runs
   `CREATE EXTENSION IF NOT EXISTS postgis`.

## 2. Migrate + seed

```sh
cd web
DATABASE_URL="$SESSION_URL" npm run db:migrate

cd ../pipeline
# If data/ is already populated from a local run, skip download/extract.
DATABASE_URL="$SESSION_URL" npm run import
```

Then trigger one stats refresh (or just wait for the first cron run) so
`office_stats` is populated.

Optional hardening (recommended once things work): apply `web/db/roles.sql`
by hand to create the least-privilege `cf_app` / `cf_vault` roles — see the
comments in that file.

## 3. Secrets

Generate once, store in a password manager, then paste into Vercel:

```sh
openssl rand -hex 32   # VAULT_ENCRYPTION_KEY
openssl rand -hex 32   # VAULT_HMAC_KEY
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # JOB_SECRET
cd web && node scripts/generate-signing-key.mjs
                       # CHECKPOINT_SIGNING_KEY (private) + CHECKPOINT_PUBLIC_KEY
```

> **The two vault keys are unrecoverable.** Lose them and every stored
> reporter identity is permanently unreadable; rotating them orphans all
> previously encrypted rows. Back them up somewhere durable.

## 4. Resend

1. Create an account at <https://resend.com>, add + verify your sending
   domain, create an API key.
2. `EMAIL_FROM` should match the verified domain, e.g.
   `CorruptionFix <no-reply@yourdomain.org>`.

Until this is set up, production OTP login cannot deliver codes (the
console-mailer fallback is dev-only).

## 5. Vercel project

1. <https://vercel.com/new> → import the `corruption.fix` GitHub repo.
2. **Root Directory: `web`** (the one setting that's easy to miss).
   Framework preset: Next.js. Build defaults are fine.
3. Environment variables (Production):

   | name | value |
   |---|---|
   | `DATABASE_URL` | `$POOL_URL` (transaction pooler, port 6543) |
   | `SESSION_SECRET` | generated above |
   | `VAULT_ENCRYPTION_KEY` | generated above |
   | `VAULT_HMAC_KEY` | generated above |
   | `CHECKPOINT_SIGNING_KEY` | generated above |
   | `CHECKPOINT_PUBLIC_KEY` | generated above |
   | `JOB_SECRET` | generated above |
   | `RESEND_API_KEY` | from Resend |
   | `EMAIL_FROM` | e.g. `CorruptionFix <no-reply@yourdomain.org>` |

   `NODE_ENV` is set by Vercel automatically. `web/src/lib/env.ts` fails the
   boot loudly if a required production variable is missing.
4. Deploy. Subsequent pushes to `main` auto-deploy; PRs get preview URLs.

## 6. Scheduled jobs (GitHub repo settings)

In the GitHub repo, **Settings → Secrets and variables → Actions**:

- Secret `JOB_SECRET` — same value as on Vercel.
- Variable `APP_URL` — the deployed origin, e.g.
  `https://corruption-fix.vercel.app` (no trailing slash).

The workflow skips cleanly until `APP_URL` is set, so enabling it later is
fine. Test it from the Actions tab via **Run workflow**.

## 7. Post-deploy smoke test

- `GET /api/health` returns ok.
- `/` renders the map with office pins; clicking a pin opens its popup.
- An office page (`/office/<id>`) shows stats.
- OTP login round-trips with a real email (Resend configured).
- Submit a test report on `/report`, then verify its reference ID on
  `/transparency`.
- Actions → Scheduled Jobs → Run workflow → all three steps green.
