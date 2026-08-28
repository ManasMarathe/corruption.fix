import { z } from "zod";
import { nominatimBboxToLngLat, type BBox, type GeocodePlace } from "./geocode";

/**
 * Persistence for the visitor's chosen map area.
 *
 * The value lives in localStorage, so the map can open at their region on
 * every later visit instead of re-asking. Two design constraints shape this
 * module:
 *
 * 1. Every function takes an injectable `Storage`. vitest runs in the `node`
 *    environment (see vitest.config.mts), where there is no `localStorage`
 *    global — passing a stub keeps the parse/validate logic unit-testable
 *    without a DOM.
 * 2. Nothing here ever throws. A corrupt, hand-edited, or older-shaped value
 *    must degrade to "no saved location" (the India view), never break the
 *    map. Note that `localStorage` access itself throws in Safari private
 *    browsing and with site data blocked — it doesn't merely return null —
 *    so the accessor is inside the try, not just the value.
 */

export const SAVED_LOCATION_KEY = "cfx.map.location.v1";

/**
 * `kind: "skipped"` records that the visitor chose "Show all of India"
 * rather than a place. Without it, skipping is indistinguishable from a
 * first visit and the prompt would nag on every load; the location chip in
 * the map chrome is how they get back to it.
 */
export type SavedLocation =
  | { v: 1; kind: "place"; key: string; name: string; bbox: BBox; savedAt: string }
  | { v: 1; kind: "skipped"; savedAt: string };

/**
 * Accepts only bboxes that pass the same range and ordering guards as a
 * freshly geocoded one — a hand-edited value must not reach `fitBounds` and
 * throw inside maplibre.
 */
const bboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((value) => {
    const [west, south, east, north] = value;
    // nominatimBboxToLngLat takes [minLat, maxLat, minLng, maxLng], so feed
    // it the stored tuple in that order to reuse one set of guards.
    return nominatimBboxToLngLat([south, north, west, east]) !== null;
  }, "bbox must be a valid [west, south, east, north] tuple");

// `v: z.literal(1)` is what makes versioning work: a future v2 payload fails
// to parse and falls back to the default view, with no migration step.
const savedLocationSchema = z.discriminatedUnion("kind", [
  z.object({
    v: z.literal(1),
    kind: z.literal("place"),
    key: z.string().min(1),
    name: z.string().min(1),
    bbox: bboxSchema,
    savedAt: z.string().min(1),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal("skipped"),
    savedAt: z.string().min(1),
  }),
]);

/** Builds the stored shape from a geocoder result. */
export function savedLocationFromPlace(place: GeocodePlace, now: Date = new Date()): SavedLocation {
  return {
    v: 1,
    kind: "place",
    key: place.key,
    name: place.shortName,
    bbox: place.bbox,
    savedAt: now.toISOString(),
  };
}

export function skippedLocation(now: Date = new Date()): SavedLocation {
  return { v: 1, kind: "skipped", savedAt: now.toISOString() };
}

export function serializeSavedLocation(location: SavedLocation): string {
  return JSON.stringify(location);
}

/** Pure parse + validate. Returns null for anything unusable; never throws. */
export function parseSavedLocation(raw: string | null): SavedLocation | null {
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = savedLocationSchema.safeParse(json);
  return parsed.success ? (parsed.data as SavedLocation) : null;
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSavedLocation(storage?: Storage | null): SavedLocation | null {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return null;

  try {
    return parseSavedLocation(store.getItem(SAVED_LOCATION_KEY));
  } catch {
    return null;
  }
}

/** Best-effort write — a full quota or blocked storage is not worth an error. */
export function writeSavedLocation(location: SavedLocation, storage?: Storage | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;

  try {
    store.setItem(SAVED_LOCATION_KEY, serializeSavedLocation(location));
  } catch {
    // Ignored: the choice just won't survive this session.
  }
}

export function clearSavedLocation(storage?: Storage | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;

  try {
    store.removeItem(SAVED_LOCATION_KEY);
  } catch {
    // Ignored.
  }
}
