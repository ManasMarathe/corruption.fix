# CorruptionFix

CorruptionFix is a civic web app that lets citizens report corruption at Indian government offices (police stations, post offices, courts, RTOs, and other govt offices) and see reports plotted on an interactive map, with a tamper-evident record of complaints and a moderated path for officers and offices to respond.

## Project layout

- `web/` — Next.js 15 (App Router, TypeScript) application: UI, API routes, Drizzle ORM schema/migrations.
- `docker-compose.yml` — Postgres 16 + PostGIS, for dev parity on machines without a native Postgres install.

## Dev setup

You need Node 22+ (CI and the Docker image both use 24), pnpm, and a Postgres 16 instance with the PostGIS extension available. Node 20 will not work — `ai@7` and the `@ai-sdk/*` packages declare `engines.node >=22`. pnpm is the only supported package manager here; the version is pinned by the `packageManager` field in `web/package.json`, so `corepack enable` is enough to get the right one. Pick one of the two paths below.

### Option A: native Postgres (Homebrew, macOS)

```bash
brew install postgresql@16 postgis
brew services start postgresql@16
createdb corruptionfix
```

Your `DATABASE_URL` will look like `postgres://localhost:5432/corruptionfix` (add a user/password if your local Postgres requires one).

### Option B: Docker Compose

If you don't have Postgres installed locally (or don't want to), use the committed `docker-compose.yml`:

```bash
docker compose up -d
```

This starts `postgis/postgis:16-3.4` on port 5432 with database `corruptionfix`, user `postgres`, password `postgres`. Your `DATABASE_URL` will then be `postgres://postgres:postgres@localhost:5432/corruptionfix`.

### App setup (either path)

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in DATABASE_URL and generate the secret keys (see table below)
pnpm db:generate          # regenerate SQL migrations from src/db/schema.ts, if you changed it
pnpm db:migrate           # apply migrations to your running Postgres instance
pnpm dev
```

Visit `http://localhost:3000` and `http://localhost:3000/api/health`.

## Environment variables

Defined and validated in `web/src/lib/env.ts`. See `web/.env.example` for a fillable template.

| Variable | Required | Format | Notes |
|---|---|---|---|
| `DATABASE_URL` | always | Postgres connection URL | e.g. `postgres://localhost:5432/corruptionfix` |
| `VAULT_ENCRYPTION_KEY` | production only | 64-char hex (32 bytes) | Encrypts reporter identity fields (email/phone) at rest in the `vault` schema. Falls back to an insecure dev default outside production (with a warning) if unset. |
| `VAULT_HMAC_KEY` | production only | 64-char hex (32 bytes) | HMACs reporter identity fields for lookup/dedup without plaintext. Same dev fallback behavior as above. |
| `CHECKPOINT_SIGNING_KEY` | no | 64-char hex (32 bytes) | Ed25519 private "seed" for signing chain checkpoints (the `sign-checkpoint` job). Generate a matched pair with `node scripts/generate-signing-key.mjs` — never commit this value. Safe to leave unset; the job skips cleanly when it is. |
| `CHECKPOINT_PUBLIC_KEY` | no | 64-char hex (32 bytes) | Public half of `CHECKPOINT_SIGNING_KEY`, produced by the same script. Safe to publish — shown on `/transparency` so anyone can independently verify checkpoint signatures. |
| `JOB_SECRET` | production only | non-empty string | Bearer token required by `/api/jobs/*` routes, called by the scheduled GitHub Actions workflow. Falls back to an insecure dev default outside production (with a warning) if unset. |
| `SESSION_SECRET` | always | non-empty string | Reserved for session-token derivation. Required in every environment, but not read by `src/lib/session.ts` today — session ids are `sha256(32 random bytes)`, which needs no server-side secret. See the comment in `web/src/lib/env.ts`. |
| `AI_GATEWAY_API_KEY` | no | non-empty string | Vercel AI Gateway key for the complaint chat assistant (`/api/chat`). Only needed for local dev — on Vercel the gateway authenticates via OIDC. |
| `NODE_ENV` | always | `development` \| `test` \| `production` | Defaults to `development`. |

Generate a fresh hex key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`CHECKPOINT_SIGNING_KEY`/`CHECKPOINT_PUBLIC_KEY` are a matched Ed25519 pair rather than independent random values, so generate them together instead:

```bash
node scripts/generate-signing-key.mjs
```

## Scripts (run from `web/`)

| Script | Description |
|---|---|
| `pnpm dev` | Start the Next.js dev server. |
| `pnpm build` | Production build (standalone output, see `web/Dockerfile`). |
| `pnpm start` | Run the production build. |
| `pnpm lint` | ESLint. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm db:generate` | Generate SQL migrations from `src/db/schema.ts` via drizzle-kit. |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL`. |
| `pnpm db:studio` | Open Drizzle Studio against `DATABASE_URL`. |

## CI

- `.github/workflows/ci.yml` — lint, typecheck, and test on every push/PR; on a push to
  `main` it then applies migrations and deploys to Vercel. Vercel's own git auto-deploy
  for `main` is switched off in `web/vercel.json` so this workflow is the single path to
  production — it needs the `PROD_DATABASE_URL` and `VERCEL_TOKEN` repository secrets
  (see `DEPLOY.md`).
- `.github/workflows/jobs.yml` — scheduled (hourly, at :23) and manually-triggerable workflow that calls the `/api/jobs/*` maintenance endpoints. Skips gracefully if the `APP_URL` repository variable isn't set.
