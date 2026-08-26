import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpCodes } from "@/db/schema";
import { constantTimeEqual, hashToken, hmacEmail, normalizeEmail } from "./crypto";
import { sendOtpEmail as sendOtpEmailDefault } from "./mailer";
import { newId } from "./uuid";
import {
  findOrCreateIdentityByEmail as findOrCreateIdentityByEmailDefault,
  markVerified as markVerifiedDefault,
} from "./vault";
import { createSession as createSessionDefault } from "./session";

/**
 * Email OTP request/verify lifecycle, backed by the `otp_codes` table.
 *
 * Design: at most one active code per `email_hmac` at a time — requesting a
 * new code deletes any prior one for that email, so there's nothing to
 * "expire" concurrently. All persistence goes through the injectable
 * `OtpStore` interface so the request/verify logic itself is pure and unit
 * testable without a live Postgres connection (see otp.test.ts).
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_VERIFY_ATTEMPTS = 5;
export const REQUEST_COOLDOWN_MS = 60 * 1000; // 60 seconds between requests

export interface OtpCodeRow {
  id: string;
  emailHmac: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
}

export interface OtpStore {
  findByEmailHmac(emailHmac: string): Promise<OtpCodeRow | null>;
  deleteByEmailHmac(emailHmac: string): Promise<void>;
  insert(row: OtpCodeRow): Promise<void>;
  incrementAttempts(id: string): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export const drizzleOtpStore: OtpStore = {
  async findByEmailHmac(emailHmac) {
    const rows = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.emailHmac, emailHmac))
      .limit(1);
    return rows[0] ?? null;
  },
  async deleteByEmailHmac(emailHmac) {
    await db.delete(otpCodes).where(eq(otpCodes.emailHmac, emailHmac));
  },
  async insert(row) {
    await db.insert(otpCodes).values(row);
  },
  async incrementAttempts(id) {
    await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id));
  },
  async deleteById(id) {
    await db.delete(otpCodes).where(eq(otpCodes.id, id));
  },
};

export interface OtpDeps {
  store: OtpStore;
  now: () => Date;
  sendOtpEmail: (to: string, code: string) => Promise<void>;
  findOrCreateIdentityByEmail: typeof findOrCreateIdentityByEmailDefault;
  markVerified: typeof markVerifiedDefault;
  createSession: (reporterId: string) => Promise<void>;
}

const defaultDeps: OtpDeps = {
  store: drizzleOtpStore,
  now: () => new Date(),
  sendOtpEmail: sendOtpEmailDefault,
  findOrCreateIdentityByEmail: findOrCreateIdentityByEmailDefault,
  markVerified: markVerifiedDefault,
  createSession: createSessionDefault,
};

function generateCode(): string {
  // randomInt is uniform over [0, 10^CODE_LENGTH) — no modulo bias.
  const max = 10 ** CODE_LENGTH;
  return randomInt(0, max).toString().padStart(CODE_LENGTH, "0");
}

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; reason: "cooldown"; retryAfterSec: number };

/**
 * Requests a new OTP code for `email`. Invalidates any code already
 * outstanding for this email once the 60s cooldown has passed; within the
 * cooldown, returns `{ ok: false, reason: "cooldown" }` instead of sending
 * another email.
 */
export async function requestOtp(
  email: string,
  deps: OtpDeps = defaultDeps
): Promise<RequestOtpResult> {
  const emailHmac = hmacEmail(email);
  const now = deps.now();

  const existing = await deps.store.findByEmailHmac(emailHmac);
  if (existing) {
    const elapsedMs = now.getTime() - existing.createdAt.getTime();
    if (elapsedMs < REQUEST_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSec: Math.ceil((REQUEST_COOLDOWN_MS - elapsedMs) / 1000),
      };
    }
    await deps.store.deleteByEmailHmac(emailHmac);
  }

  const code = generateCode();
  await deps.store.insert({
    id: newId(),
    emailHmac,
    codeHash: hashToken(code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    createdAt: now,
  });

  // Ensure the identity row exists as soon as an email is used, not only on
  // successful verification — otherwise findOrCreateIdentityByEmail on
  // verify would race a concurrent second request for the same address.
  await deps.findOrCreateIdentityByEmail(email, "otp_request");

  await deps.sendOtpEmail(normalizeEmail(email), code);

  return { ok: true };
}

export type VerifyOtpResult =
  | { ok: true; reporterId: string }
  | {
      ok: false;
      reason: "not_found" | "expired" | "too_many_attempts" | "incorrect";
    };

/**
 * Verifies a submitted code against the active code for `email`. On
 * success: marks the reporter identity verified, creates a session, and
 * consumes (deletes) the code so it can't be replayed.
 */
export async function verifyOtp(
  email: string,
  code: string,
  deps: OtpDeps = defaultDeps
): Promise<VerifyOtpResult> {
  const emailHmac = hmacEmail(email);
  const now = deps.now();

  const row = await deps.store.findByEmailHmac(emailHmac);
  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  if (row.expiresAt.getTime() <= now.getTime()) {
    await deps.store.deleteById(row.id);
    return { ok: false, reason: "expired" };
  }

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    await deps.store.deleteById(row.id);
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!constantTimeEqual(hashToken(code), row.codeHash)) {
    await deps.store.incrementAttempts(row.id);
    return { ok: false, reason: "incorrect" };
  }

  await deps.store.deleteById(row.id);

  const { reporterId } = await deps.findOrCreateIdentityByEmail(email, "otp_verify");
  await deps.markVerified(reporterId, "self", "otp_verify");
  await deps.createSession(reporterId);

  return { ok: true, reporterId };
}
