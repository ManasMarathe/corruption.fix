import type { OfficeCategory } from "@/db/schema";
import { CATEGORY_LIST } from "./categories";
import { defaultMapFilters, type MapFilters } from "./map-filters";
import { SERVICE_LIST } from "./services";

/**
 * The map view <-> query-string bridge.
 *
 * MapHome has always *read* `?lat&lng&zoom` (plus `name`/`category`/`id` to
 * reopen a pin's popup), but nothing ever wrote them, so a view could be
 * deep-linked into and never out of. This module owns both directions, as
 * pure functions over `URLSearchParams`, so the round trip is unit-testable
 * without a browser.
 *
 * Param vocabulary, unchanged for the three that already existed:
 *   lat, lng, zoom  — the view
 *   id, name, category — the office whose popup is open, if any
 *   cat   — comma-separated categories; omitted when all are shown
 *   svc   — comma-separated services; omitted when none is selected
 *   reports=1, approx=1 — the two boolean filters, omitted when default
 *
 * Filters are omitted at their default value rather than always written, so
 * an unfiltered map produces a short, obviously-shareable URL.
 */

export interface MapView {
  lng: number;
  lat: number;
  zoom: number;
}

/** The office whose popup is open, carried in the URL so a pin is linkable. */
export interface MapFocus {
  id: string;
  name: string;
  category: OfficeCategory;
}

/**
 * Coordinate precision. 5 decimal places is ~1 m — past the point where a
 * map view differs visibly, and short enough that the URL stays readable.
 * Zoom gets 2, which is finer than any wheel notch.
 */
const COORD_DECIMALS = 5;
const ZOOM_DECIMALS = 2;

/** Drops trailing zeros, so 18.00 serialises as "18" rather than "18.00". */
function round(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

function parseFiniteNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads `lat`/`lng`/`zoom`. Returns null unless *both* coordinates are
 * present and finite — `Number(null)` is 0, not NaN, so a bare "/" would
 * otherwise resolve to [0,0] and jump the map to the Gulf of Guinea.
 *
 * Out-of-range coordinates are rejected too: a hand-edited `lat=200` must
 * degrade to "no view in the URL", not throw inside maplibre.
 */
export function parseMapView(params: URLSearchParams): MapView | null {
  const lat = parseFiniteNumber(params.get("lat"));
  const lng = parseFiniteNumber(params.get("lng"));
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const zoomRaw = parseFiniteNumber(params.get("zoom"));
  // Matches the previous inline default in MapHome.focusFromQueryParams.
  const zoom = zoomRaw === null ? 15 : Math.min(22, Math.max(0, zoomRaw));

  return { lng, lat, zoom };
}

/** Reads `id`/`name`/`category`. `id` alone is what makes a focus usable. */
export function parseMapFocus(params: URLSearchParams): MapFocus | null {
  const id = params.get("id");
  if (!id) return null;

  const rawCategory = params.get("category");
  const category = (CATEGORY_LIST as string[]).includes(rawCategory ?? "")
    ? (rawCategory as OfficeCategory)
    : "other";

  return { id, name: params.get("name") ?? "", category };
}

/**
 * Reads the filter params, falling back to each dimension's default when it
 * is absent or unusable. Unknown tokens are dropped rather than rejecting
 * the whole value, and an empty category list falls back to "all" — a map
 * showing nothing at all is never what a link meant.
 */
export function parseMapFilters(params: URLSearchParams): MapFilters {
  const filters = defaultMapFilters();

  const rawCategories = params.get("cat");
  if (rawCategories !== null) {
    const allowed = rawCategories
      .split(",")
      .map((token) => token.trim())
      .filter((token): token is OfficeCategory =>
        (CATEGORY_LIST as string[]).includes(token)
      );
    if (allowed.length > 0) filters.categories = new Set(allowed);
  }

  const rawServices = params.get("svc");
  if (rawServices !== null) {
    filters.services = new Set(
      rawServices
        .split(",")
        .map((token) => token.trim())
        .filter((token) => (SERVICE_LIST as string[]).includes(token))
    ) as MapFilters["services"];
  }

  filters.withReportsOnly = params.get("reports") === "1";
  filters.includeApproximate = params.get("approx") === "1";

  return filters;
}

/**
 * Builds the params for a view. Ordering is fixed (view, focus, filters) so
 * the same state always produces byte-identical URLs — otherwise a
 * `replaceState` on every `moveend` could churn the address bar with
 * reordered but equivalent strings.
 */
export function mapStateToParams(
  view: MapView,
  filters: MapFilters,
  focus: MapFocus | null = null
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("lat", round(view.lat, COORD_DECIMALS));
  params.set("lng", round(view.lng, COORD_DECIMALS));
  params.set("zoom", round(view.zoom, ZOOM_DECIMALS));

  if (focus) {
    params.set("id", focus.id);
    if (focus.name) params.set("name", focus.name);
    params.set("category", focus.category);
  }

  if (filters.categories.size !== CATEGORY_LIST.length) {
    // Emit in CATEGORY_LIST order, not Set insertion order, so toggling a
    // category off and back on doesn't permute the URL.
    params.set("cat", CATEGORY_LIST.filter((c) => filters.categories.has(c)).join(","));
  }
  if (filters.services.size > 0) {
    params.set("svc", SERVICE_LIST.filter((s) => filters.services.has(s)).join(","));
  }
  if (filters.withReportsOnly) params.set("reports", "1");
  if (filters.includeApproximate) params.set("approx", "1");

  return params;
}

/** `"?lat=…&lng=…"` — what goes into `history.replaceState`. */
export function mapStateToSearch(
  view: MapView,
  filters: MapFilters,
  focus: MapFocus | null = null
): string {
  return `?${mapStateToParams(view, filters, focus).toString()}`;
}
