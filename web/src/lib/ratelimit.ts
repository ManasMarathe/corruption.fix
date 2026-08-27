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
    // drizzle-orm's postgres-js driver deliberately disables postgres.js's
    // own Date -> timestamptz serialization (it registers a no-op
    // "transparentParser" for the timestamptz OID — see
    // node_modules/drizzle-orm/postgres-js/driver.js) because it expects
    // to have already converted Date values to strings itself via each
    // column's driver-value mapping. That mapping only runs for values
    // passed through `.values()`/typed column helpers — a raw `Date`
    // interpolated directly into a `sql` template (as `cutoff`/`now` are
    // here) bypasses it entirely and reaches postgres.js unconverted,
    // which then throws ("argument must be of type string ... received
    // Date") deep in wire-protocol encoding. Interpolating `.toISOString()`
    // strings instead sidesteps the gap.
    const nowIso = now.toISOString();
    const cutoffIso = cutoff.toISOString();

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
