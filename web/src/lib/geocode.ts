import { z } from "zod";

/**
 * Place geocoding: turning a typed place name ("Pune", "Kerala") into a
 * bounding box the map can fit to.
 *
 * This module deliberately imports nothing but zod — no `env`, no `db`, no
 * maplibre — so it can be imported from the API route, from client
 * components, and from a plain node vitest run without pulling in a database
 * connection or a WebGL-touching bundle.
 *
 * The upstream provider is OSM Nominatim. Its usage policy requires a
 * descriptive User-Agent and discourages high request rates, which is why
 * every call is proxied through /api/geocode rather than made from the
 * browser — see src/app/api/geocode/route.ts.
 */

/**
 * [west, south, east, north] — maplibre's `LngLatBoundsLike` tuple order,
 * and the same order the /api/offices bbox param uses.
 */
export type BBox = [number, number, number, number];

/**
 * Bounds of the pmtiles archive (see pipeline/README.md), used as the map's
 * default view when the visitor hasn't chosen an area. Lives here rather
 * than in MapHome so the map, the geocoder's India check, and the tests all
 * share one definition.
 */
export const INDIA_BOUNDS: BBox = [68.958232, 8.002868, 97.019637, 34.811197];

export interface GeocodePlace {
  /** `${osm_type}:${osm_id}` — stable across queries, used as the React key. */
  key: string;
  /** Full `display_name`, shown as the dropdown row. */
  name: string;
  /** Short label for the location chip, e.g. "Pune". */
  shortName: string;
  bbox: BBox;
  /** [lng, lat] — the bbox centre, not Nominatim's lat/lon (which can sit
   * outside the bbox for oddly-shaped relations). */
  center: [number, number];
}

/** Minimum bbox span, in degrees, that `expandTinyBbox` will enforce (~2 km). */
const MIN_BBOX_SPAN_DEG = 0.02;

/**
 * Converts Nominatim's `boundingbox` to maplibre's tuple order.
 *
 * Nominatim returns `[minLat, maxLat, minLng, maxLng]` **as strings** — a
 * different order *and* type from `[west, south, east, north]`. Getting this
 * backwards silently sends the map to the wrong hemisphere rather than
 * failing loudly, so the whole conversion lives in one tested function.
 *
 * Returns null (rather than throwing) for anything malformed, so one bad row
 * in a response can't sink the rest.
 */
export function nominatimBboxToLngLat(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;

  const nums = raw.map((value) =>
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  );
  if (!nums.every((n) => Number.isFinite(n))) return null;

  const [minLat, maxLat, minLng, maxLng] = nums as [number, number, number, number];

  // Same range/ordering guards as parseBbox in /api/offices/route.ts.
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  if (minLat >= maxLat || minLng >= maxLng) return null;

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Widens a degenerate bounding box around its centre.
 *
 * A Nominatim *node* result — a village, a single building — comes back with
 * a span of ~0.001°, and `fitBounds` on that snaps the map to street level.
 * MapHome also passes `maxZoom` as a second line of defence; this one keeps
 * the stored bbox itself sane.
 */
export function expandTinyBbox(bbox: BBox, minSpanDeg: number = MIN_BBOX_SPAN_DEG): BBox {
  const [west, south, east, north] = bbox;

  const padAxis = (min: number, max: number): [number, number] => {
    const span = max - min;
    if (span >= minSpanDeg) return [min, max];
    const pad = (minSpanDeg - span) / 2;
    return [min - pad, max + pad];
  };

  const [paddedWest, paddedEast] = padAxis(west, east);
  const [paddedSouth, paddedNorth] = padAxis(south, north);

  return [
    Math.max(-180, paddedWest),
    Math.max(-90, paddedSouth),
    Math.min(180, paddedEast),
    Math.min(90, paddedNorth),
  ];
}

/**
 * Belt-and-braces behind the upstream `countrycodes=in` filter: drops any
 * result whose bbox doesn't overlap the tile archive's coverage, since the
 * map has no office data to show there anyway.
 */
export function intersectsIndia(bbox: BBox): boolean {
  const [west, south, east, north] = bbox;
  const [iWest, iSouth, iEast, iNorth] = INDIA_BOUNDS;
  return west <= iEast && east >= iWest && south <= iNorth && north >= iSouth;
}

/**
 * Canonical cache key for a query, so "Pune ", "pune" and "Pune  City" don't
 * each cost a separate upstream request.
 */
export function normalizeGeocodeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

const nominatimResultSchema = z.object({
  osm_type: z.string().min(1),
  osm_id: z.union([z.number(), z.string()]),
  display_name: z.string().min(1),
  name: z.string().optional(),
  boundingbox: z.unknown(),
});

/**
 * Total, throw-free normalization of an upstream response body.
 *
 * Driven by a per-element `safeParse` so a Nominatim schema change degrades
 * to "no results" rather than a 500. Entries with an unusable bounding box,
 * or that fall outside India, are dropped.
 */
export function normalizeNominatimResults(raw: unknown, limit?: number): GeocodePlace[] {
  if (!Array.isArray(raw)) return [];

  const places: GeocodePlace[] = [];

  for (const entry of raw) {
    if (limit !== undefined && places.length >= limit) break;

    const parsed = nominatimResultSchema.safeParse(entry);
    if (!parsed.success) continue;

    const converted = nominatimBboxToLngLat(parsed.data.boundingbox);
    if (!converted) continue;
    if (!intersectsIndia(converted)) continue;

    const bbox = expandTinyBbox(converted);
    const displayName = parsed.data.display_name;
    const shortName = parsed.data.name?.trim() || displayName.split(",")[0]!.trim();

    places.push({
      key: `${parsed.data.osm_type}:${parsed.data.osm_id}`,
      name: displayName,
      shortName,
      bbox,
      center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    });
  }

  return places;
}
