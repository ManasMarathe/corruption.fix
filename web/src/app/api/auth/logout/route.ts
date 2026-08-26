import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { destroySession } from "@/lib/session";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.auth.errors.badOrigin);
  }

  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ err: error }, "logout failed");
    return errorResponse(500, "server_error", strings.auth.errors.serverError);
  }
}
