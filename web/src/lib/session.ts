import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { hashToken } from "./crypto";
import { env } from "./env";

/**
 * Opaque bearer-token sessions. The raw token lives only in the `cf_session`
 * httpOnly cookie; the database stores sha256(token) as the session's
 * primary key, so a stolen database dump doesn't hand out working session
 * tokens (same rationale as OTP code hashing in otp.ts).
 */

export const SESSION_COOKIE_NAME = "cf_session";
const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed (no sliding expiry).

export interface SessionInfo {
  reporterId: string;
}

/**
 * Creates a new session for `reporterId` and sets the session cookie on the
 * current response. Must be called from a Route Handler (or Server Action)
 * — Server Components can only read cookies, not set them.
 */
export async function createSession(reporterId: string): Promise<void> {
  const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ id, reporterId, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * Reads and validates the current session, if any. Safe to call from
 * Server Components and Route Handlers alike (read-only).
 */
export async function getSession(): Promise<SessionInfo | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const id = hashToken(token);
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return { reporterId: row.reporterId };
}

/**
 * Ends the current session: deletes it from the database and clears the
 * cookie. Must be called from a Route Handler.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
