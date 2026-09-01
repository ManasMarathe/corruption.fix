import { describe, expect, it } from "vitest";
import { CATEGORY_LIST } from "./categories";
import { defaultMapFilters, type MapFilters } from "./map-filters";
import {
  mapStateToParams,
  mapStateToSearch,
  parseMapFilters,
  parseMapFocus,
  parseMapView,
} from "./map-url";

/**
 * The map view is the one piece of app state that lives in the URL, so a
 * serialise/parse round trip has to be exact: a link that reopens a
 * *different* view than the one it was copied from is worse than no link.
 */

function search(state: string): URLSearchParams {
  return new URLSearchParams(state);
}

describe("parseMapView", () => {
  it("reads lat/lng/zoom", () => {
    expect(parseMapView(search("lat=18.52&lng=73.85&zoom=14"))).toEqual({
      lat: 18.52,
      lng: 73.85,
      zoom: 14,
    });
  });

  it("defaults zoom to 15 when absent", () => {
    expect(parseMapView(search("lat=18.52&lng=73.85"))?.zoom).toBe(15);
  });

  it.each([
    ["no params", ""],
    ["lat only", "lat=18.52"],
    ["lng only", "lng=73.85"],
    ["empty values", "lat=&lng="],
    ["non-numeric", "lat=abc&lng=73.85"],
    ["out of range lat", "lat=200&lng=73.85"],
    ["out of range lng", "lat=18.52&lng=999"],
  ])("returns null for %s", (_label, query) => {
    expect(parseMapView(search(query))).toBeNull();
  });

  it("clamps an absurd zoom rather than passing it to maplibre", () => {
    expect(parseMapView(search("lat=1&lng=1&zoom=900"))?.zoom).toBe(22);
    expect(parseMapView(search("lat=1&lng=1&zoom=-5"))?.zoom).toBe(0);
  });
});

describe("parseMapFocus", () => {
  it("reads id, name and category", () => {
    expect(parseMapFocus(search("id=abc&name=Shivajinagar&category=police"))).toEqual({
      id: "abc",
      name: "Shivajinagar",
      category: "police",
    });
  });

  it("falls back to `other` for an unknown category", () => {
    expect(parseMapFocus(search("id=abc&category=spaceport"))?.category).toBe("other");
  });

  it("returns null without an id", () => {
    expect(parseMapFocus(search("name=Shivajinagar&category=police"))).toBeNull();
  });
});

describe("parseMapFilters", () => {
  it("returns the defaults for an empty query string", () => {
    expect(parseMapFilters(search(""))).toEqual(defaultMapFilters());
  });

  it("reads every dimension", () => {
    const filters = parseMapFilters(search("cat=police,court&svc=aadhaar&reports=1&approx=1"));
    expect([...filters.categories].sort()).toEqual(["court", "police"]);
    expect([...filters.services]).toEqual(["aadhaar"]);
    expect(filters.withReportsOnly).toBe(true);
    expect(filters.includeApproximate).toBe(true);
  });

  it("drops unknown tokens instead of rejecting the value", () => {
    const filters = parseMapFilters(search("cat=police,spaceport&svc=aadhaar,teleportation"));
    expect([...filters.categories]).toEqual(["police"]);
    expect([...filters.services]).toEqual(["aadhaar"]);
  });

  it("falls back to every category when the list parses to nothing", () => {
    // A map showing no categories at all is never what a link meant.
    expect(parseMapFilters(search("cat=spaceport")).categories.size).toBe(CATEGORY_LIST.length);
  });
});

describe("mapStateToParams", () => {
  const view = { lat: 18.516726, lng: 73.856255, zoom: 14.257 };

  it("omits every filter that is at its default", () => {
    const params = mapStateToParams(view, defaultMapFilters());
    expect(params.get("cat")).toBeNull();
    expect(params.get("svc")).toBeNull();
    expect(params.get("reports")).toBeNull();
    expect(params.get("approx")).toBeNull();
  });

  it("rounds coordinates and drops trailing zeros", () => {
    const params = mapStateToParams({ lat: 18.5167263, lng: 73.8562551, zoom: 14 }, defaultMapFilters());
    expect(params.get("lat")).toBe("18.51673");
    expect(params.get("lng")).toBe("73.85626");
    expect(params.get("zoom")).toBe("14");
  });

  it("emits categories in CATEGORY_LIST order regardless of Set insertion order", () => {
    const a: MapFilters = { ...defaultMapFilters(), categories: new Set(["court", "police"]) };
    const b: MapFilters = { ...defaultMapFilters(), categories: new Set(["police", "court"]) };
    expect(mapStateToParams(view, a).toString()).toBe(mapStateToParams(view, b).toString());
  });

  it("includes the focused office when one is open", () => {
    const params = mapStateToParams(view, defaultMapFilters(), {
      id: "abc",
      name: "Shivajinagar",
      category: "police",
    });
    expect(params.get("id")).toBe("abc");
    expect(params.get("category")).toBe("police");
  });
});

describe("round trip", () => {
  it("restores the same view, focus and filters", () => {
    const view = { lat: 18.51673, lng: 73.85626, zoom: 12.5 };
    const filters: MapFilters = {
      categories: new Set(["police", "rto"]),
      services: new Set(["aadhaar", "fir"]),
      withReportsOnly: true,
      includeApproximate: true,
    };
    const focus = { id: "abc", name: "Shivajinagar", category: "police" as const };

    const params = search(mapStateToSearch(view, filters, focus).slice(1));

    expect(parseMapView(params)).toEqual(view);
    expect(parseMapFocus(params)).toEqual(focus);
    expect(parseMapFilters(params)).toEqual(filters);
  });

  it("is stable — serialising a parsed state reproduces the same string", () => {
    const first = mapStateToSearch(
      { lat: 18.51673, lng: 73.85626, zoom: 12.5 },
      { ...defaultMapFilters(), withReportsOnly: true }
    );
    const params = search(first.slice(1));
    const second = mapStateToSearch(parseMapView(params)!, parseMapFilters(params));
    expect(second).toBe(first);
  });
});
