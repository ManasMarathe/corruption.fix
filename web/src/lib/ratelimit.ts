import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limiter backed by the `rate_limits` table, keyed
 * `<scope>:<key>` (e.g. "otp-request-ip:203.0.113.4",
 * "otp-request-email:<email hmac>").
 *
 * Each call atomically bumps the counter for the key in a single upsert: if
 * the existing window has expired (its start is older than `windowSec`
 * ago), the window resets to `count = 1` starting now; otherwise the count
 * is incremented. Because this is one SQL statement (INSERT ... ON CONFLICT
 * DO UPDATE), Postgres serializes concurrent bumps of the same key via the
 * row lock — there's no read-then-write race.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry. 0 when `allowed` is true. */
  retryAfterSec: number;
}

export interface RateLimitStore {
  /** Bumps the counter for `key`, resetting it if `windowSec` has elapsed
   * since the window's recorded start. Returns the window's (possibly just
   * reset) start time and the count after this bump. */
  bump(
    key: string,
    now: Date,
    windowSec: number
  ): Promise<{ windowStart: Date; count: number }>;
}

export const drizzleRateLimitStore: RateLimitStore = {
  async bump(key, now, windowSec) {
    const cutoff = new Date(now.getTime() - windowSec * 1000);
    // Pre-serialize to ISO strings before interpolating into the raw `sql`
    // CASE fragments below. Values that flow through drizzle's `.values()`
    // get the `timestamp` column's date-mode serialization automatically,
    // but a Date interpolated directly into a `sql` template is handed to
    // postgres.js as-is; here it ends up bound to a parameter position
    // whose inferred type postgres.js has no built-in Date serializer for
    // (it appears alongside a column reference inside CASE/THEN, not in a
    // typed column position), which throws
    // `TypeError [ERR_INVALID_ARG_TYPE]: ... Received an instance of Date`
    // deep in postgres.js's Bind-message encoding. A plain string parameter
    // never hits that path.
    const cutoffIso = cutoff.toISOString();
    const nowIso = now.toISOString();

    const rows = await db
      .insert(rateLimits)
      .values({ key, windowStart: now, count: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoffIso} THEN ${nowIso} ELSE ${rateLimits.windowStart} END`,
          count: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoffIso} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        },
      })
      .returning({ windowStart: rateLimits.windowStart, count: rateLimits.count });

    return rows[0];
  },
};

/**
 * Checks and consumes one unit of `scope:key`'s rate limit.
 *
 * @param max Maximum allowed count per window (inclusive).
 * @param windowSec Window length in seconds.
 */
export async function limit(
  scope: string,
  key: string,
  max: number,
  windowSec: number,
  deps: { store?: RateLimitStore; now?: () => Date } = {}
): Promise<RateLimitResult> {
  const now = (deps.now ?? (() => new Date()))();
  const store = deps.store ?? drizzleRateLimitStore;

  const { windowStart, count } = await store.bump(`${scope}:${key}`, now, windowSec);
  const allowed = count <= max;

  if (allowed) {
    return { allowed: true, retryAfterSec: 0 };
  }

  const elapsedSec = (now.getTime() - windowStart.getTime()) / 1000;
  const retryAfterSec = Math.max(0, Math.ceil(windowSec - elapsedSec));
  return { allowed: false, retryAfterSec };
}
