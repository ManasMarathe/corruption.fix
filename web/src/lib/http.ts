import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Small shared helpers for API route handlers: a consistent JSON error
 * envelope, a same-origin check for mutating routes, and best-effort client
 * IP extraction for per-IP rate limiting.
 */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): NextResponse<ErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/**
 * Best-effort client IP for rate-limiting purposes. This app is deployed
 * behind a reverse proxy that sets X-Forwarded-For; NextRequest itself has
 * no reliable `.ip` outside Vercel's runtime.
 */
export function clientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/**
 * Rejects a mutating request whose Origin doesn't match Host, guarding
 * against cross-site form/fetch submissions riding on the session cookie.
 * Requests with no Origin header (some non-browser clients, certain
 * same-origin navigations) are allowed through — there's nothing to compare
 * against, and the httpOnly + SameSite=lax cookie already limits exposure.
 */
export function checkOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
