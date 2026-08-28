import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// A single shared connection pool for the process. In dev, this module can
// be re-evaluated on hot reload, so the client is cached on `globalThis` to
// avoid exhausting Postgres connections.
const globalForDb = globalThis as unknown as {
  __corruptionfixQueryClient?: ReturnType<typeof postgres>;
};

const queryClient =
  globalForDb.__corruptionfixQueryClient ??
  postgres(env.DATABASE_URL, {
    // On Vercel each route is its own function and each instance serves
    // roughly one request at a time, so a big per-process pool just holds
    // Supavisor client slots hostage across N concurrent instances and
    // requests end up queueing on connection acquisition. Keep it small.
    max: env.NODE_ENV === "production" ? 2 : 5,
    // Supabase's connection pooler (Supavisor, transaction mode — the URL
    // Vercel should use) multiplexes many clients over few server
    // connections and therefore can't support session-scoped prepared
    // statements. postgres.js prepares every query by default, so leave it
    // off; also applies cleanly to direct connections.
    prepare: false,
    // In a serverless runtime, idle connections in a frozen instance just
    // hold pooler slots — release them quickly.
    idle_timeout: 20,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.__corruptionfixQueryClient = queryClient;
}

export const db = drizzle(queryClient, { schema });

export { queryClient };
