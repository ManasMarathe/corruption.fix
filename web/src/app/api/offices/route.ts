import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OFFICE_CATEGORIES } from "@/db/schema";
import { checkOrigin, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { insertUserOffice, userOfficesInBbox, type Bbox } from "@/lib/offices";
import { limit } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 500;

function parseBbox(raw: string): Bbox | null {
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (
    minLng < -180 ||
    maxLng > 180 ||
    minLat < -90 ||
    maxLat > 90 ||
    minLng >= maxLng ||
    minLat >= maxLat
  ) {
    return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}

const bboxParamSchema = z.string().min(1);

/**
 * GET /api/offices?bbox=minLng,minLat,maxLng,maxLat
 *
 * User-added (`source = 'user'`) offices intersecting the bbox, capped at
 * `MAX_RESULTS`. No cursor pagination — the cap keeps a single page cheap,
 * and callers are expected to re-request on `moveend` with a new bbox
 * rather than paginate through a fixed view.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("bbox");
  const paramCheck = bboxParamSchema.safeParse(raw);
  if (!paramCheck.success) {
    return errorResponse(400, "invalid_bbox", strings.map.errors.invalidBbox);
  }

  const bbox = parseBbox(paramCheck.data);
  if (!bbox) {
    return errorResponse(400, "invalid_bbox", strings.map.errors.invalidBbox);
  }

  try {
    const results = await userOfficesInBbox(bbox, MAX_RESULTS);
    return NextResponse.json({ offices: results });
  } catch (error) {
    log.error({ err: error }, "offices bbox query failed");
    return errorResponse(500, "server_error", strings.map.errors.serverError);
  }
}

const postBodySchema = z.object({
  name: z.string().trim().min(2, "name too short").max(200, "name too long"),
  category: z.enum(OFFICE_CATEGORIES),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(500).optional(),
});

const ADD_OFFICE_LIMIT = { max: 5, windowSec: 24 * 60 * 60 };

/**
 * POST /api/offices — add-office submissions. Requires a session, is
 * rate-limited per reporter (5/day), and always inserts with
 * `source = 'user'`, `status = 'user_added'` — never `'seeded'`/`'osm'`,
 * which are reserved for the pipeline import.
 */
export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.addOffice.errors.badOrigin);
  }

  const session = await getSession();
  if (!session) {
    return errorResponse(401, "unauthorized", strings.addOffice.errors.unauthorized);
  }

  const json = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "invalid_body", strings.addOffice.errors.invalidBody);
  }

  const rateLimitResult = await limit(
    "add-office-reporter",
    session.reporterId,
    ADD_OFFICE_LIMIT.max,
    ADD_OFFICE_LIMIT.windowSec
  );
  if (!rateLimitResult.allowed) {
    return errorResponse(429, "rate_limited", strings.addOffice.errors.rateLimited, {
      "Retry-After": String(rateLimitResult.retryAfterSec),
    });
  }

  try {
    const office = await insertUserOffice(parsed.data);
    return NextResponse.json({ office }, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "add office failed");
    return errorResponse(500, "server_error", strings.addOffice.errors.serverError);
  }
}
