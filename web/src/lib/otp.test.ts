import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken, hmacEmail } from "./crypto";
import {
  CODE_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  REQUEST_COOLDOWN_MS,
  requestOtp,
  verifyOtp,
  type OtpCodeRow,
  type OtpDeps,
  type OtpStore,
} from "./otp";

/** In-memory OtpStore, one row per emailHmac (mirrors the real semantics:
 * requesting a new code replaces the prior one). */
function createMemoryStore(): OtpStore {
  const rows = new Map<string, OtpCodeRow>();
  return {
    async findByEmailHmac(emailHmac) {
      return rows.get(emailHmac) ?? null;
    },
    async deleteByEmailHmac(emailHmac) {
      rows.delete(emailHmac);
    },
    async insert(row) {
      rows.set(row.emailHmac, row);
    },
    async incrementAttempts(id) {
      for (const row of rows.values()) {
        if (row.id === id) row.attempts += 1;
      }
    },
    async deleteById(id) {
      for (const [key, row] of rows.entries()) {
        if (row.id === id) rows.delete(key);
      }
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

/** Captures the last code "sent" by the fake mailer so tests can verify it. */
interface Harness {
  deps: OtpDeps;
  clock: ReturnType<typeof clockAt>;
  lastSentCode: () => string | undefined;
  sessionsCreatedFor: string[];
  verifiedReporterIds: string[];
}

function createHarness(): Harness {
  const clock = clockAt(0);
  const sentCodes: { to: string; code: string }[] = [];
  const sessionsCreatedFor: string[] = [];
  const verifiedReporterIds: string[] = [];

  // Fake identity vault: assigns a stable reporterId per emailHmac.
  const identities = new Map<string, string>();
  let nextId = 0;

  const deps: OtpDeps = {
    store: createMemoryStore(),
    now: clock.now,
    sendOtpEmail: vi.fn(async (to: string, code: string) => {
      sentCodes.push({ to, code });
    }),
    findOrCreateIdentityByEmail: vi.fn(async (email: string) => {
      const key = hmacEmail(email);
      let reporterId = identities.get(key);
      if (!reporterId) {
        reporterId = `reporter-${nextId++}`;
        identities.set(key, reporterId);
      }
      return { reporterId, verified: false };
    }) as OtpDeps["findOrCreateIdentityByEmail"],
    markVerified: vi.fn(async (reporterId: string) => {
      verifiedReporterIds.push(reporterId);
    }) as OtpDeps["markVerified"],
    createSession: vi.fn(async (reporterId: string) => {
      sessionsCreatedFor.push(reporterId);
    }),
  };

  return {
    deps,
    clock,
    lastSentCode: () => sentCodes.at(-1)?.code,
    sessionsCreatedFor,
    verifiedReporterIds,
  };
}

describe("requestOtp", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it("sends a 6-digit numeric code", async () => {
    const result = await requestOtp("reporter@example.com", h.deps);
    expect(result.ok).toBe(true);
    const code = h.lastSentCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("stores only the hash of the code, not the code itself", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const code = h.lastSentCode()!;
    const row = await h.deps.store.findByEmailHmac(hmacEmail("reporter@example.com"));
    expect(row?.codeHash).toBe(hashToken(code));
    expect(row?.codeHash).not.toBe(code);
  });

  it("sets a 10 minute expiry", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const row = await h.deps.store.findByEmailHmac(hmacEmail("reporter@example.com"));
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(CODE_TTL_MS);
  });

  it("rejects a re-request within the 60s cooldown", async () => {
    await requestOtp("reporter@example.com", h.deps);
    h.clock.advance(30_000);
    const second = await requestOtp("reporter@example.com", h.deps);
    expect(second).toEqual({ ok: false, reason: "cooldown", retryAfterSec: 30 });
  });

  it("allows a re-request once the cooldown has elapsed, invalidating the prior code", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const firstCode = h.lastSentCode();

    h.clock.advance(REQUEST_COOLDOWN_MS + 1);
    const second = await requestOtp("reporter@example.com", h.deps);
    expect(second.ok).toBe(true);

    const secondCode = h.lastSentCode();
    expect(secondCode).not.toBe(firstCode);

    // Only one active code should exist for this email.
    const row = await h.deps.store.findByEmailHmac(hmacEmail("reporter@example.com"));
    expect(row?.codeHash).toBe(hashToken(secondCode!));
  });

  it("normalizes email casing/whitespace for the cooldown check", async () => {
    await requestOtp("Reporter@Example.com", h.deps);
    const second = await requestOtp("  reporter@example.com  ", h.deps);
    expect(second.ok).toBe(false);
  });
});

describe("verifyOtp", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it("fails with not_found when no code was requested", async () => {
    const result = await verifyOtp("nobody@example.com", "123456", h.deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("succeeds with the correct code, creates a session, and marks verified", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const code = h.lastSentCode()!;

    const result = await verifyOtp("reporter@example.com", code, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(h.verifiedReporterIds).toContain(result.reporterId);
    expect(h.sessionsCreatedFor).toContain(result.reporterId);
  });

  it("consumes the code so it can't be replayed", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const code = h.lastSentCode()!;

    await verifyOtp("reporter@example.com", code, h.deps);
    const replay = await verifyOtp("reporter@example.com", code, h.deps);
    expect(replay).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an incorrect code without consuming it, and increments attempts", async () => {
    await requestOtp("reporter@example.com", h.deps);

    const wrong = await verifyOtp("reporter@example.com", "000000", h.deps);
    expect(wrong).toEqual({ ok: false, reason: "incorrect" });

    const row = await h.deps.store.findByEmailHmac(hmacEmail("reporter@example.com"));
    expect(row?.attempts).toBe(1);
  });

  it("locks out after the max number of incorrect attempts", async () => {
    await requestOtp("reporter@example.com", h.deps);

    for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
      await verifyOtp("reporter@example.com", "000000", h.deps);
    }

    const locked = await verifyOtp("reporter@example.com", "000000", h.deps);
    expect(locked).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("expires the code after the TTL", async () => {
    await requestOtp("reporter@example.com", h.deps);
    const code = h.lastSentCode()!;

    h.clock.advance(CODE_TTL_MS + 1);
    const result = await verifyOtp("reporter@example.com", code, h.deps);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("never creates a session on failure", async () => {
    await requestOtp("reporter@example.com", h.deps);
    await verifyOtp("reporter@example.com", "000000", h.deps);
    expect(h.sessionsCreatedFor).toHaveLength(0);
  });
});
