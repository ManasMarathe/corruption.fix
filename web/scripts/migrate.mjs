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
console.log(`Connecting to ${parsed.hostname} on port ${port}.`);

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

// The other Supabase trap, and the one the port check above cannot see: a
// direct-connection host (db.<ref>.supabase.co) is on port 5432 too, exactly
// like the session pooler, so the URL looks correct. But Supabase's direct
// connections have been IPv6-only since 2024, and GitHub Actions runners
// have no IPv6 route — the job fails with ENETUNREACH against an IPv6
// literal after appearing to start normally. The pooler hostname is
// dual-stack and works from anywhere.
if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(parsed.hostname)) {
  console.error(
    `${parsed.hostname} is Supabase's DIRECT connection host, which is ` +
      "IPv6-only. GitHub Actions runners have no IPv6 connectivity, so this " +
      "will fail with ENETUNREACH even though the port (5432) is right.\n" +
      "Use the session pooler host instead — it is also on 5432 and looks " +
      "like aws-0-<region>.pooler.supabase.com. Copy it from the project " +
      "dashboard under Connect -> Session pooler."
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
  // Catches the same IPv6 problem when it arrives via a hostname the check
  // above does not recognise (a custom domain, a CNAME, a non-Supabase host).
  if (
    (error?.code === "ENETUNREACH" || error?.code === "EHOSTUNREACH") &&
    /:[0-9a-f]*:/i.test(String(error?.message ?? ""))
  ) {
    console.error(
      "  -> That address is IPv6. This runner has no IPv6 route, so the " +
        "host has to resolve to IPv4 — on Supabase that means the session " +
        "pooler (aws-0-<region>.pooler.supabase.com:5432), not the direct " +
        "db.<ref>.supabase.co host."
    );
  }
  // Postgres errors carry the useful detail off to the side of `message`.
  for (const field of ["code", "detail", "hint", "where", "severity"]) {
    if (error?.[field]) console.error(`  ${field}: ${error[field]}`);
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
