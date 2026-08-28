import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { lookupOfficeByOsmUid } from "@/lib/offices";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

const querySchema = z.coerce.number().int().positive();

/**
 * GET /api/offices/lookup?osm_uid= — resolves a pmtiles feature's
 * `osm_uid` property (a `bigint`-safe globally-unique id — see
 * pipeline/README.md's "osm_uid convention") back to a DB office row, via
 * the unique index on `offices.osm_id`.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("osm_uid");
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "invalid_osm_uid", strings.map.errors.invalidOsmUid);
  }

  try {
    const office = await lookupOfficeByOsmUid(parsed.data);
    if (!office) {
      return errorResponse(404, "not_found", strings.map.errors.notFound);
    }
    // The osm_uid → office mapping is effectively immutable (seeded from
    // the OSM extract), so let Vercel's CDN serve repeat lookups.
    return NextResponse.json(
      { office },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    log.error({ err: error }, "office lookup failed");
    return errorResponse(500, "server_error", strings.map.errors.serverError);
  }
}
