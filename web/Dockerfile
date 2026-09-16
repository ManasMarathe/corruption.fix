# Multi-stage build producing a minimal standalone Next.js image.
# Build context must be the web/ directory, e.g.:
#   docker build -t corruptionfix-web -f web/Dockerfile web

# Node 24, matching .github/workflows/ci.yml and the Vercel runtime. Not a
# free choice: ai@7 and every @ai-sdk/* package declare engines.node >=22.
# Pinned to 24 rather than tracking latest because Corepack — which is how
# pnpm gets activated below — ships with Node 24 but was removed from the
# distribution in later majors.
#
# ---- deps -------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
# corepack reads the "packageManager" field in package.json, so the pnpm
# version used here is the same one CI and developers use, with nothing to
# keep in sync by hand.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# ---- builder ------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable
# Build-time env vars are not real secrets; runtime config is supplied via
# the container's environment (see .env.example for the full list).
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runner ---------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
