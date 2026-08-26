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
  postgres(env.DATABASE_URL, { max: env.NODE_ENV === "production" ? 10 : 5 });

if (env.NODE_ENV !== "production") {
  globalForDb.__corruptionfixQueryClient = queryClient;
}

export const db = drizzle(queryClient, { schema });

export { queryClient };
