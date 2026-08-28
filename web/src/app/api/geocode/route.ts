import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { normalizeGeocodeQuery, normalizeNominatimResults } from "@/lib/geocode";
import { clientIp, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { limit } from "@/lib/ratelimit";
import { strings } from "@/lib/strings";

/**
 * GET /api/geocode?q= — place name -> bounding box, for the map's "where are
 * you?" prompt.
 *
 * This exists as a server-side proxy rather than a direct browser call for
 * three reasons, all of which matter:
 *
 * - The CSP is `connect-src 'self'` (see next.config.ts). Keeping geocoding
 *   here means it stays that way.
 * - Nominatim's usage policy requires a descriptive User-Agent, and browsers
 *   forbid setting that header.
 * - It's the only place we can rate-limit and cache on behalf of all
 *   visitors. The 24h `revalidate` below matters more than the limiter: a
 *   handful of city names will dominate traffic, and repeated queries never
 *   reach the upstream at all.
 */

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 6;
const UPSTREAM_TIMEOUT_MS = 5_000;
/** Place geometry is effectively static, so cache the upstream hard. */
const UPSTREAM_REVALIDATE_SEC = 86_400;

// A global ceiling on our aggregate egress, on top of the per-IP limits.
// Nominatim asks for ~1 req/s; the fixed-window limiter can burst at a
// window boundary, so 45/60 leaves headroom for that while still keeping us
// roughly within policy under distributed load.
const GLOBAL_MAX_PER_MIN = 45;

const querySchema = z.string().trim().min(3).max(120);

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("q") ?? "";
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "invalid_query", strings.map.errors.invalidPlaceQuery);
  }

  const ip = clientIp(request);
  try {
    const checks = await Promise.all([
      limit("geocode-ip", ip, 30, 60),
      limit("geocode-ip-day", ip, 300, 86_400),
      limit("geocode-global", "all", GLOBAL_MAX_PER_MIN, 60),
    ]);
    const blocked = checks.find((check) => !check.allowed);
    if (blocked) {
      return errorResponse(429, "rate_limited", strings.map.errors.geocodeRateLimited, {
        "Retry-After": String(blocked.retryAfterSec),
      });
    }
  } catch (error) {
    log.error({ err: error }, "geocode rate limit check failed");
    return errorResponse(500, "server_error", strings.map.errors.serverError);
  }

  const query = normalizeGeocodeQuery(parsed.data);
  const url = new URL("/search", env.NOMINATIM_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  // Constrain to the tile archive's coverage upstream; normalizeNominatim-
  // Results also drops anything outside INDIA_BOUNDS as a second check.
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "en");

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": env.GEOCODER_USER_AGENT,
        Accept: "application/json",
      },
      next: { revalidate: UPSTREAM_REVALIDATE_SEC },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      log.error({ status: upstream.status }, "geocode upstream returned an error");
      return errorResponse(502, "geocode_unavailable", strings.map.errors.geocodeUnavailable);
    }

    const results = normalizeNominatimResults(await upstream.json(), RESULT_LIMIT);

    return NextResponse.json(
      { results },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (error) {
    // Covers timeouts, DNS/network failures and a non-JSON body. The upstream
    // URL is deliberately not surfaced to the client.
    log.error({ err: error }, "geocode upstream failed");
    return errorResponse(502, "geocode_unavailable", strings.map.errors.geocodeUnavailable);
  }
}
