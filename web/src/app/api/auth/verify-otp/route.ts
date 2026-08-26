import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkOrigin, clientIp, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { verifyOtp, type VerifyOtpResult } from "@/lib/otp";
import { limit } from "@/lib/ratelimit";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});

const IP_LIMIT = { max: 20, windowSec: 3600 };

const FAILURE_RESPONSES: Record<
  Exclude<VerifyOtpResult, { ok: true }>["reason"],
  { status: number; code: string; message: string }
> = {
  not_found: { status: 400, code: "not_found", message: strings.auth.errors.codeNotFound },
  expired: { status: 400, code: "expired", message: strings.auth.errors.codeExpired },
  too_many_attempts: {
    status: 429,
    code: "too_many_attempts",
    message: strings.auth.errors.tooManyAttempts,
  },
  incorrect: { status: 401, code: "incorrect", message: strings.auth.errors.codeIncorrect },
};

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.auth.errors.badOrigin);
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "invalid_code", strings.auth.errors.invalidCode);
  }
  const { email, code } = parsed.data;

  const ip = clientIp(request);
  const ipLimit = await limit("otp-verify-ip", ip, IP_LIMIT.max, IP_LIMIT.windowSec);
  if (!ipLimit.allowed) {
    return errorResponse(429, "rate_limited", strings.auth.errors.rateLimited, {
      "Retry-After": String(ipLimit.retryAfterSec),
    });
  }

  try {
    const result = await verifyOtp(email, code);
    if (!result.ok) {
      const failure = FAILURE_RESPONSES[result.reason];
      return errorResponse(failure.status, failure.code, failure.message);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ err: error }, "verify-otp failed");
    return errorResponse(500, "server_error", strings.auth.errors.serverError);
  }
}
