import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { offices } from "@/db/schema";
import { errorResponse } from "@/lib/http";
import { isValidId } from "@/lib/uuid";
import { log } from "@/lib/log";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

/**
 * Minimal office lookup for the /report page's header ("You're reporting
 * on: <name>"). Deliberately narrow — id/name/category only, no geometry,
 * stats, or anything else — so the /report flow doesn't need to reach into
 * the /api/offices* surface another agent owns.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !isValidId(id)) {
    return errorResponse(400, "invalid_id", "A valid office id is required.");
  }

  try {
    const rows = await db
      .select({ id: offices.id, name: offices.name, category: offices.category })
      .from(offices)
      .where(eq(offices.id, id))
      .limit(1);

    const office = rows[0];
    if (!office) {
      return errorResponse(404, "not_found", strings.report.errors.officeNotFound);
    }

    return NextResponse.json(office);
  } catch (error) {
    log.error({ err: error }, "office-context lookup failed");
    return errorResponse(500, "server_error", strings.report.errors.serverError);
  }
}
