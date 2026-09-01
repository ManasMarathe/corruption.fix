import { describe, expect, it } from "vitest";
import { formatDistanceKm, haversineKm } from "./distance";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm([73.85, 18.52], [73.85, 18.52])).toBe(0);
  });

  it("matches a known distance (Pune -> Mumbai, ~120 km)", () => {
    const km = haversineKm([73.8567, 18.5204], [72.8777, 19.076]);
    expect(km).toBeGreaterThan(115);
    expect(km).toBeLessThan(125);
  });

  it("is symmetric", () => {
    const a: [number, number] = [73.8567, 18.5204];
    const b: [number, number] = [72.8777, 19.076];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("formatDistanceKm", () => {
  it.each([
    [0.04, "40 m"],
    [0.456, "460 m"],
    [1, "1.0 km"],
    [2.34, "2.3 km"],
    [18.4, "18 km"],
  ])("formats %s km as %s", (km, expected) => {
    expect(formatDistanceKm(km)).toBe(expected);
  });

  it("returns an empty label rather than NaN for unusable input", () => {
    expect(formatDistanceKm(NaN)).toBe("");
    expect(formatDistanceKm(-1)).toBe("");
  });
});
