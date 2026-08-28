import { describe, expect, it } from "vitest";
import {
  expandTinyBbox,
  intersectsIndia,
  nominatimBboxToLngLat,
  normalizeGeocodeQuery,
  normalizeNominatimResults,
  type BBox,
} from "./geocode";

describe("nominatimBboxToLngLat", () => {
  it("reorders [minLat, maxLat, minLng, maxLng] strings to [w, s, e, n] numbers", () => {
    // Pune-ish. The order flip is the whole point of this function: getting
    // it wrong sends the map to the wrong hemisphere without erroring.
    expect(nominatimBboxToLngLat(["18.4", "18.6", "73.7", "73.9"])).toEqual([
      73.7, 18.4, 73.9, 18.6,
    ]);
  });

  it("keeps negative coordinates in the right slots", () => {
    // A swapped lat/lng pair would still be in range here, so only the exact
    // ordering distinguishes a correct conversion from a broken one.
    expect(nominatimBboxToLngLat(["-34.0", "-33.5", "-58.6", "-58.3"])).toEqual([
      -58.6, -34.0, -58.3, -33.5,
    ]);
  });

  it("accepts numbers as well as strings", () => {
    expect(nominatimBboxToLngLat([18.4, 18.6, 73.7, 73.9])).toEqual([73.7, 18.4, 73.9, 18.6]);
  });

  it("rejects malformed input", () => {
    expect(nominatimBboxToLngLat(null)).toBeNull();
    expect(nominatimBboxToLngLat(undefined)).toBeNull();
    expect(nominatimBboxToLngLat("18.4,18.6,73.7,73.9")).toBeNull();
    expect(nominatimBboxToLngLat([])).toBeNull();
    expect(nominatimBboxToLngLat(["18.4", "18.6", "73.7"])).toBeNull();
    expect(nominatimBboxToLngLat(["a", "b", "c", "d"])).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(nominatimBboxToLngLat(["18.4", "95", "73.7", "73.9"])).toBeNull();
    expect(nominatimBboxToLngLat(["18.4", "18.6", "73.7", "200"])).toBeNull();
  });

  it("rejects inverted axes", () => {
    expect(nominatimBboxToLngLat(["18.6", "18.4", "73.7", "73.9"])).toBeNull();
    expect(nominatimBboxToLngLat(["18.4", "18.6", "73.9", "73.7"])).toBeNull();
  });
});

describe("expandTinyBbox", () => {
  it("widens a degenerate node bbox around its centre", () => {
    const tiny: BBox = [73.85, 18.52, 73.851, 18.521];
    const [west, south, east, north] = expandTinyBbox(tiny, 0.02);

    expect(east - west).toBeCloseTo(0.02, 6);
    expect(north - south).toBeCloseTo(0.02, 6);
    // Centre is preserved.
    expect((west + east) / 2).toBeCloseTo((73.85 + 73.851) / 2, 6);
    expect((south + north) / 2).toBeCloseTo((18.52 + 18.521) / 2, 6);
  });

  it("leaves a state-sized bbox untouched", () => {
    const kerala: BBox = [74.85, 8.18, 77.42, 12.79];
    expect(expandTinyBbox(kerala, 0.02)).toEqual(kerala);
  });

  it("clamps padding to valid lng/lat ranges", () => {
    const [west, south, east, north] = expandTinyBbox([-180, -90, -179.999, -89.999], 0.02);
    expect(west).toBeGreaterThanOrEqual(-180);
    expect(south).toBeGreaterThanOrEqual(-90);
    expect(east).toBeLessThanOrEqual(180);
    expect(north).toBeLessThanOrEqual(90);
  });
});

describe("intersectsIndia", () => {
  it("accepts a bbox inside the tile coverage", () => {
    expect(intersectsIndia([73.7, 18.4, 73.9, 18.6])).toBe(true);
  });

  it("rejects a bbox well outside it", () => {
    // Paris.
    expect(intersectsIndia([2.22, 48.81, 2.47, 48.9])).toBe(false);
  });
});

describe("normalizeGeocodeQuery", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(normalizeGeocodeQuery("  Pune   City ")).toBe("pune city");
  });
});

describe("normalizeNominatimResults", () => {
  const pune = {
    osm_type: "relation",
    osm_id: 1942586,
    display_name: "Pune, Pune District, Maharashtra, India",
    name: "Pune",
    boundingbox: ["18.4", "18.6", "73.7", "73.9"],
  };

  it("builds a stable key and both name forms", () => {
    const [place] = normalizeNominatimResults([pune]);

    expect(place!.key).toBe("relation:1942586");
    expect(place!.name).toBe("Pune, Pune District, Maharashtra, India");
    expect(place!.shortName).toBe("Pune");
    expect(place!.bbox).toEqual([73.7, 18.4, 73.9, 18.6]);
    expect(place!.center).toEqual([73.80000000000001, 18.5]);
  });

  it("falls back to the first display_name segment when `name` is absent", () => {
    const [place] = normalizeNominatimResults([{ ...pune, name: undefined }]);
    expect(place!.shortName).toBe("Pune");
  });

  it("drops entries with a missing or unusable bounding box", () => {
    const noBbox = { ...pune, boundingbox: undefined };
    const badBbox = { ...pune, boundingbox: ["a", "b", "c", "d"] };
    expect(normalizeNominatimResults([noBbox, badBbox, pune])).toHaveLength(1);
  });

  it("drops entries missing osm_id", () => {
    expect(normalizeNominatimResults([{ ...pune, osm_id: undefined }])).toEqual([]);
  });

  it("drops results outside India", () => {
    const paris = {
      osm_type: "relation",
      osm_id: 71525,
      display_name: "Paris, Île-de-France, France",
      boundingbox: ["48.81", "48.90", "2.22", "2.47"],
    };
    expect(normalizeNominatimResults([paris])).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...pune, osm_id: i }));
    expect(normalizeNominatimResults(many, 2)).toHaveLength(2);
  });

  it("returns [] for junk without throwing", () => {
    expect(normalizeNominatimResults(null)).toEqual([]);
    expect(normalizeNominatimResults({})).toEqual([]);
    expect(normalizeNominatimResults("nope")).toEqual([]);
    expect(normalizeNominatimResults([null, 42, "x"])).toEqual([]);
  });
});
