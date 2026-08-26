import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { getSession } from "@/lib/session";
import { errorResponse } from "@/lib/http";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

// Never returns email/phone — only whether a session is active and, if so,
// the opaque reporter id. Contact info lives exclusively behind
// src/lib/vault.ts's logged access paths.
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({ authenticated: true, reporterId: session.reporterId });
  } catch (error) {
    log.error({ err: error }, "auth/me failed");
    return errorResponse(500, "server_error", strings.auth.errors.serverError);
  }
}
