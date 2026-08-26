import { defineConfig } from "drizzle-kit";

// Load .env.local for local CLI use (drizzle-kit generate/migrate/studio)
// without pulling in an extra `dotenv` dependency — Node 20.6+ ships
// process.loadEnvFile natively.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present (e.g. in CI) — fall back to process.env / default.
}

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/corruptionfix";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public", "vault"],
  dbCredentials: {
    url: databaseUrl,
  },
});
