import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hmacEmail } from "@/lib/crypto";
import { checkOrigin, clientIp, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { requestOtp } from "@/lib/otp";
import { limit } from "@/lib/ratelimit";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
});

const IP_LIMIT = { max: 10, windowSec: 3600 };
const EMAIL_LIMIT = { max: 5, windowSec: 3600 };

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.auth.errors.badOrigin);
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "invalid_email", strings.auth.errors.invalidEmail);
  }
  const { email } = parsed.data;

  const ip = clientIp(request);
  const ipLimit = await limit("otp-request-ip", ip, IP_LIMIT.max, IP_LIMIT.windowSec);
  if (!ipLimit.allowed) {
    return errorResponse(429, "rate_limited", strings.auth.errors.rateLimited, {
      "Retry-After": String(ipLimit.retryAfterSec),
    });
  }

  const emailLimit = await limit(
    "otp-request-email",
    hmacEmail(email),
    EMAIL_LIMIT.max,
    EMAIL_LIMIT.windowSec
  );
  if (!emailLimit.allowed) {
    return errorResponse(429, "rate_limited", strings.auth.errors.rateLimited, {
      "Retry-After": String(emailLimit.retryAfterSec),
    });
  }

  try {
    const result = await requestOtp(email);
    if (!result.ok) {
      return errorResponse(429, "cooldown", strings.auth.errors.cooldown, {
        "Retry-After": String(result.retryAfterSec),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ err: error }, "request-otp failed");
    return errorResponse(500, "server_error", strings.auth.errors.serverError);
  }
}
