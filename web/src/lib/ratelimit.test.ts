import { describe, expect, it } from "vitest";
import { limit, type RateLimitStore } from "./ratelimit";

/**
 * In-memory stand-in for the `rate_limits` table, replicating the same
 * fixed-window reset semantics as `drizzleRateLimitStore`'s SQL upsert:
 * bumping resets the window (count = 1) if the existing window started more
 * than `windowSec` ago, otherwise it just increments.
 */
function createMemoryStore(): RateLimitStore {
  const rows = new Map<string, { windowStart: Date; count: number }>();

  return {
    async bump(key, now, windowSec) {
      const cutoff = new Date(now.getTime() - windowSec * 1000);
      const existing = rows.get(key);

      if (!existing || existing.windowStart.getTime() <= cutoff.getTime()) {
        const row = { windowStart: now, count: 1 };
        rows.set(key, row);
        return row;
      }

      existing.count += 1;
      return existing;
    },
  };
}

function clockAt(startMs: number) {
  let now = startMs;
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("limit", () => {
  it("allows requests up to max within the window", async () => {
    const store = createMemoryStore();
    const clock = clockAt(0);

    for (let i = 0; i < 3; i++) {
      const result = await limit("scope", "key", 3, 60, { store, now: clock.now });
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSec).toBe(0);
    }
  });

  it("blocks once the count exceeds max, with a positive retryAfterSec", async () => {
    const store = createMemoryStore();
    const clock = clockAt(0);

    for (let i = 0; i < 3; i++) {
      await limit("scope", "key", 3, 60, { store, now: clock.now });
    }

    clock.advance(10_000); // 10s into the 60s window
    const blocked = await limit("scope", "key", 3, 60, { store, now: clock.now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(50);
  });

  it("resets the window once windowSec has elapsed", async () => {
    const store = createMemoryStore();
    const clock = clockAt(0);

    await limit("scope", "key", 1, 60, { store, now: clock.now });
    const secondImmediate = await limit("scope", "key", 1, 60, { store, now: clock.now });
    expect(secondImmediate.allowed).toBe(false);

    clock.advance(60_001); // window has now fully elapsed
    const afterReset = await limit("scope", "key", 1, 60, { store, now: clock.now });
    expect(afterReset.allowed).toBe(true);
  });

  it("tracks separate keys independently", async () => {
    const store = createMemoryStore();
    const clock = clockAt(0);

    await limit("scope", "a", 1, 60, { store, now: clock.now });
    const other = await limit("scope", "b", 1, 60, { store, now: clock.now });
    expect(other.allowed).toBe(true);
  });

  it("tracks separate scopes independently for the same key", async () => {
    const store = createMemoryStore();
    const clock = clockAt(0);

    await limit("scope-a", "key", 1, 60, { store, now: clock.now });
    const other = await limit("scope-b", "key", 1, 60, { store, now: clock.now });
    expect(other.allowed).toBe(true);
  });
});
