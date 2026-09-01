/**
 * Applies pending migrations, with errors you can actually act on.
 *
 * `drizzle-kit migrate` prints "applying migrations..." and then exits 1
 * with no message at all when the connection or a statement fails, which
 * makes a failed deploy pipeline a guessing game. This runs the same
 * migrations through drizzle-orm's migrator — the same `drizzle` folder and
 * the same `drizzle.__drizzle_migrations` bookkeeping table, so the two are
 * interchangeable — and reports what actually went wrong.
 *
 * Nothing here prints the connection string or any part of it beyond the
 * port, which is not a secret and is the field most likely to be wrong.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error(
    "DATABASE_URL is not a parseable URL. A raw '@' in the password will do " +
      "this — it has to be percent-encoded as %40."
  );
  process.exit(1);
}

const port = parsed.port || "5432";
console.log(`Connecting on port ${port}.`);

// Supabase's transaction pooler multiplexes many clients over few server
// connections, so it cannot hold the session-scoped advisory lock or the
// prepared statements a migration run depends on. The app deliberately uses
// it (with prepare: false) — migrations must not.
if (port === "6543") {
  console.error(
    "Port 6543 is Supabase's transaction pooler, which cannot run migrations: " +
      "session-scoped advisory locks and prepared statements do not survive it. " +
      "Use the session pooler on port 5432 instead."
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [{ version }] = await sql`select version()`;
  console.log(`Connected: ${version.split(",")[0]}`);

  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} catch (error) {
  console.error(`Migration failed: ${error?.message ?? error}`);
  // Postgres errors carry the useful detail off to the side of `message`.
  for (const field of ["code", "detail", "hint", "where", "severity"]) {
    if (error?.[field]) console.error(`  ${field}: ${error[field]}`);
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
