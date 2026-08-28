import { describe, expect, it, vi } from "vitest";
import type { GeocodePlace } from "./geocode";
import {
  parseSavedLocation,
  readSavedLocation,
  savedLocationFromPlace,
  serializeSavedLocation,
  skippedLocation,
  writeSavedLocation,
  SAVED_LOCATION_KEY,
  type SavedLocation,
} from "./saved-location";

const PUNE: GeocodePlace = {
  key: "relation:1942586",
  name: "Pune, Pune District, Maharashtra, India",
  shortName: "Pune",
  bbox: [73.7, 18.4, 73.9, 18.6],
  center: [73.8, 18.5],
};

/** Minimal in-memory Storage — proves the injectable design needs no DOM. */
function stubStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("parseSavedLocation", () => {
  it("round-trips a place", () => {
    const location = savedLocationFromPlace(PUNE, new Date("2026-08-27T10:00:00.000Z"));
    expect(parseSavedLocation(serializeSavedLocation(location))).toEqual({
      v: 1,
      kind: "place",
      key: "relation:1942586",
      name: "Pune",
      bbox: [73.7, 18.4, 73.9, 18.6],
      savedAt: "2026-08-27T10:00:00.000Z",
    });
  });

  it("round-trips a skip", () => {
    const location = skippedLocation(new Date("2026-08-27T10:00:00.000Z"));
    expect(parseSavedLocation(serializeSavedLocation(location))).toEqual({
      v: 1,
      kind: "skipped",
      savedAt: "2026-08-27T10:00:00.000Z",
    });
  });

  it("returns null for absent or non-JSON values", () => {
    expect(parseSavedLocation(null)).toBeNull();
    expect(parseSavedLocation("")).toBeNull();
    expect(parseSavedLocation("{")).toBeNull();
    expect(parseSavedLocation("[]")).toBeNull();
    expect(parseSavedLocation('"pune"')).toBeNull();
  });

  it("returns null for a different payload version", () => {
    expect(
      parseSavedLocation(
        JSON.stringify({ v: 2, kind: "place", key: "k", name: "Pune", bbox: [73.7, 18.4, 73.9, 18.6], savedAt: "x" })
      )
    ).toBeNull();
  });

  it("returns null for an unknown or missing kind", () => {
    expect(parseSavedLocation(JSON.stringify({ v: 1, savedAt: "x" }))).toBeNull();
    expect(parseSavedLocation(JSON.stringify({ v: 1, kind: "elsewhere", savedAt: "x" }))).toBeNull();
  });

  it("returns null for a malformed bbox", () => {
    const withBbox = (bbox: unknown) =>
      JSON.stringify({ v: 1, kind: "place", key: "k", name: "Pune", bbox, savedAt: "x" });

    expect(parseSavedLocation(withBbox(undefined))).toBeNull();
    expect(parseSavedLocation(withBbox([73.7, 18.4, 73.9]))).toBeNull();
    expect(parseSavedLocation(withBbox(["73.7", "18.4", "73.9", "18.6"]))).toBeNull();
    // Inverted longitude axis.
    expect(parseSavedLocation(withBbox([73.9, 18.4, 73.7, 18.6]))).toBeNull();
    // Latitude out of range.
    expect(parseSavedLocation(withBbox([73.7, 18.4, 73.9, 200]))).toBeNull();
  });
});

describe("readSavedLocation / writeSavedLocation", () => {
  it("writes and reads back through an injected Storage", () => {
    const storage = stubStorage();
    const location = savedLocationFromPlace(PUNE);

    writeSavedLocation(location, storage);
    expect(storage.getItem(SAVED_LOCATION_KEY)).toBeTruthy();
    expect(readSavedLocation(storage)).toEqual(location);
  });

  it("returns null when nothing is stored", () => {
    expect(readSavedLocation(stubStorage())).toBeNull();
  });

  it("returns null when no storage is available", () => {
    expect(readSavedLocation(null)).toBeNull();
  });

  it("returns null when getItem throws (Safari private browsing)", () => {
    const storage = stubStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    expect(readSavedLocation(storage)).toBeNull();
  });

  it("swallows a throwing setItem (quota exceeded)", () => {
    const storage = stubStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });

    const location: SavedLocation = skippedLocation();
    expect(() => writeSavedLocation(location, storage)).not.toThrow();
  });
});
