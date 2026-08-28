import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { OFFICE_CATEGORIES, OFFICE_SERVICES, offices, type OfficeService } from "@/db/schema";
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

// `services=aadhaar,banking` is optional and deliberately lenient: unknown
// tokens are dropped rather than rejected with a 400. A hard-validation
// error path here would need its own strings.ts message (e.g.
// `map.errors.invalidServices`), which this file doesn't own — see the task
// report. Silently ignoring garbage input is an acceptable fallback for an
// additive filter param.
function parseServicesParam(raw: string | null): OfficeService[] | undefined {
  if (!raw) return undefined;
  const known = new Set<string>(OFFICE_SERVICES);
  const services = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OfficeService => known.has(s));
  return services.length > 0 ? services : undefined;
}

/**
 * GET /api/offices?bbox=minLng,minLat,maxLng,maxLat&services=aadhaar,banking
 *
 * User-added (`source = 'user'`) offices intersecting the bbox, capped at
 * `MAX_RESULTS`. No cursor pagination — the cap keeps a single page cheap,
 * and callers are expected to re-request on `moveend` with a new bbox
 * rather than paginate through a fixed view. `services` optionally narrows
 * to offices offering at least one of the listed services.
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

  const services = parseServicesParam(request.nextUrl.searchParams.get("services"));

  try {
    const results = await userOfficesInBbox(bbox, MAX_RESULTS, services);
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

// Conservative on purpose: a false positive here blocks a legitimate
// contribution, which is worse than occasionally letting a real duplicate
// through (the client-side warning in AddOfficeClient already catches the
// common case pre-submit; this is the last line of defense). 100m matches
// that client-side check. 0.6 trigram similarity requires the names to be
// genuinely close — not just sharing a common word like "police" or
// "office" — while still catching near-identical spelling/spacing variants.
const DUPLICATE_RADIUS_M = 100;
const DUPLICATE_NAME_SIMILARITY = 0.6;

/**
 * Same-category, near-identical-name office within `DUPLICATE_RADIUS_M`.
 * Raw SQL (not the Drizzle query builder) for the same reason as
 * src/lib/offices.ts: ST_DWithin/ST_MakePoint/similarity() aren't exposed
 * through the builder, and `offices.geom` is compared via ::geography here
 * rather than selected, so the EWKB round-trip issue noted there doesn't
 * apply. Uses the general `offices_geom_gix` GiST index (kept in
 * drizzle/0002_perf_indexes.sql specifically for all-source spatial
 * queries like this one, unlike the user-only partial index) and the
 * pg_trgm GIN index on `name`.
 */
async function findConflictingOffice(input: {
  name: string;
  category: string;
  lat: number;
  lng: number;
}): Promise<boolean> {
  const rows = await db.execute<{ conflict: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${offices}
      WHERE ${offices.category} = ${input.category}
        AND ST_DWithin(
          ${offices.geom}::geography,
          ST_MakePoint(${input.lng}, ${input.lat})::geography,
          ${DUPLICATE_RADIUS_M}
        )
        AND similarity(${offices.name}, ${input.name}) > ${DUPLICATE_NAME_SIMILARITY}
    ) AS conflict
  `);
  return rows[0]?.conflict ?? false;
}

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
    // Conservative on purpose: a false positive blocks a legitimate
    // contribution, which is worse than letting an occasional duplicate
    // through. Note this can only see offices the DB holds — the bulk of the
    // map comes from the pmtiles archive, so near-duplicates of OSM-sourced
    // offices are not caught here.
    const hasConflict = await findConflictingOffice({
      name: parsed.data.name,
      category: parsed.data.category,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    });
    if (hasConflict) {
      return errorResponse(409, "duplicate_office", strings.addOffice.errors.duplicateOffice);
    }

    const office = await insertUserOffice(parsed.data);
    return NextResponse.json({ office }, { status: 201 });
  } catch (error) {
    log.error({ err: error }, "add office failed");
    return errorResponse(500, "server_error", strings.addOffice.errors.serverError);
  }
}
