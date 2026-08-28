import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { searchOffices } from "@/lib/offices";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 10;

const querySchema = z.string().trim().min(1).max(100);

/**
 * GET /api/offices/search?q= — ILIKE %q% over office names, capped at 10.
 * Each result includes `services` (e.g. so the UI can show "Post office ·
 * Aadhaar") — see the `OfficePoint`/`OFFICE_POINT_COLUMNS` comments in
 * lib/offices.ts for how that's populated without fanning out rows.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("q") ?? "";
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "invalid_query", strings.map.errors.invalidQuery);
  }

  try {
    const results = await searchOffices(parsed.data, RESULT_LIMIT);
    // Office names are near-static OSM data; a short CDN TTL lets popular
    // query strings skip the DB. Kept modest so user-added offices show
    // up in search within minutes.
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
    );
  } catch (error) {
    log.error({ err: error }, "office search failed");
    return errorResponse(500, "server_error", strings.map.errors.serverError);
  }
}
