import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { bumpOfficeView } from "@/lib/offices";
import { strings } from "@/lib/strings";
import { isValidId } from "@/lib/uuid";

export const dynamic = "force-dynamic";

/**
 * POST /api/offices/[id]/view — fire-and-forget view counter beacon, called
 * by a tiny client component on the office page (never blocking the page
 * render). Always responds 200/`{ok:true}` even when the bump itself fails
 * (bad id, FK violation, transient DB error) — a lost view count is not
 * worth surfacing as an error to the beacon caller.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.auth.errors.badOrigin);
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ ok: true });
  }

  try {
    await bumpOfficeView(id);
  } catch (error) {
    log.warn({ err: error, officeId: id }, "office view count bump failed");
  }

  return NextResponse.json({ ok: true });
}
