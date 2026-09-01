import { z } from "zod";
import { CATEGORY_LIST } from "./categories";
import { nominatimBboxToLngLat, type BBox, type GeocodePlace } from "./geocode";
import type { OfficeCategory } from "@/db/schema";

/**
 * The last few things the visitor searched for, shown when the search box is
 * focused but empty — the "recent" list Google Maps opens with.
 *
 * Follows the same two rules as saved-location.ts, for the same reasons:
 * every function takes an injectable `Storage` so the parse logic is
 * testable under `node` vitest, and nothing here ever throws — a corrupt or
 * older-shaped value degrades to "no recents", never a broken search box.
 * (localStorage access itself throws in Safari private browsing, so the
 * accessor sits inside the try, not just the value.)
 */

export const RECENT_SEARCHES_KEY = "cfx.map.recent.v1";

/** How many entries are kept. Beyond this the list stops being "recent". */
export const RECENT_SEARCH_LIMIT = 5;

export type RecentSearch =
  | { v: 1; kind: "place"; key: string; name: string; bbox: BBox }
  | {
      v: 1;
      kind: "office";
      id: string;
      name: string;
      category: OfficeCategory;
      lng: number;
      lat: number;
    };

/** Same guard as saved-location.ts: a hand-edited bbox must not reach fitBounds. */
const bboxSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((value) => {
    const [west, south, east, north] = value;
    return nominatimBboxToLngLat([south, north, west, east]) !== null;
  }, "bbox must be a valid [west, south, east, north] tuple");

const recentSearchSchema = z.discriminatedUnion("kind", [
  z.object({
    v: z.literal(1),
    kind: z.literal("place"),
    key: z.string().min(1),
    name: z.string().min(1),
    bbox: bboxSchema,
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal("office"),
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(CATEGORY_LIST as [OfficeCategory, ...OfficeCategory[]]),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }),
]);

export type RecentPlace = Extract<RecentSearch, { kind: "place" }>;
export type RecentOffice = Extract<RecentSearch, { kind: "office" }>;

export function recentFromPlace(place: GeocodePlace): RecentPlace {
  return { v: 1, kind: "place", key: place.key, name: place.shortName, bbox: place.bbox };
}

export function recentFromOffice(office: {
  id: string;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
}): RecentOffice {
  return {
    v: 1,
    kind: "office",
    id: office.id,
    name: office.name,
    category: office.category,
    lng: office.lng,
    lat: office.lat,
  };
}

/** Identity for dedupe: re-picking the same place moves it to the top. */
export function recentSearchId(entry: RecentSearch): string {
  return entry.kind === "place" ? `place:${entry.key}` : `office:${entry.id}`;
}

/**
 * Pure parse + validate of the whole list. Individual malformed entries are
 * dropped rather than discarding the list — one bad row shouldn't cost the
 * visitor their other four.
 */
export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];

  const entries: RecentSearch[] = [];
  for (const item of json) {
    if (entries.length >= RECENT_SEARCH_LIMIT) break;
    const parsed = recentSearchSchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data as RecentSearch);
  }
  return entries;
}

/** Newest first, deduped by identity, capped. Pure — callers persist it. */
export function addRecentSearch(existing: RecentSearch[], entry: RecentSearch): RecentSearch[] {
  const id = recentSearchId(entry);
  return [entry, ...existing.filter((item) => recentSearchId(item) !== id)].slice(
    0,
    RECENT_SEARCH_LIMIT
  );
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readRecentSearches(storage?: Storage | null): RecentSearch[] {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return [];

  try {
    return parseRecentSearches(store.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

/** Best-effort write — a full quota or blocked storage is not worth an error. */
export function writeRecentSearches(entries: RecentSearch[], storage?: Storage | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;

  try {
    store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(entries.slice(0, RECENT_SEARCH_LIMIT)));
  } catch {
    // Ignored: the list just won't survive this session.
  }
}
