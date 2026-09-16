import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { featureForRow } from "./prepare-tiles-geojson.mjs";

/**
 * These cover the row -> tile-feature mapping that the web map's filter
 * expressions read (see buildFilterExpression in
 * web/src/components/map/MapHome.tsx). The two halves are in different
 * languages and different repositories-worth of code, so the property names
 * and value shapes here are a contract, not an implementation detail.
 */

const baseRow = {
  id: "018f2e2a-0000-7000-8000-000000000001",
  osm_id: null,
  name: "Ambewadi Post Office",
  category: "post_office",
  lng: "72.8777",
  lat: "19.076",
  location_precision: "exact",
  services: [],
  has_reports: false,
};

describe("featureForRow", () => {
  test("always carries id, name and category, and a Point geometry", () => {
    const feature = featureForRow(baseRow);
    assert.equal(feature.type, "Feature");
    assert.deepEqual(feature.geometry, {
      type: "Point",
      coordinates: [72.8777, 19.076],
    });
    assert.equal(feature.properties.id, baseRow.id);
    assert.equal(feature.properties.name, baseRow.name);
    assert.equal(feature.properties.category, "post_office");
  });

  test("omits osm_uid for non-OSM rows and coerces it to a number otherwise", () => {
    assert.equal("osm_uid" in featureForRow(baseRow).properties, false);
    // postgres.js returns int8 as a string; the tiles must carry a number.
    const osm = featureForRow({ ...baseRow, osm_id: "10000000123" });
    assert.equal(osm.properties.osm_uid, 10_000_000_123);
  });

  test("joins services with commas and omits the property when there are none", () => {
    assert.equal("services" in featureForRow(baseRow).properties, false);
    const withServices = featureForRow({
      ...baseRow,
      services: ["aadhaar", "banking"],
    });
    assert.equal(withServices.properties.services, "aadhaar,banking");
  });

  test("writes precision only when approximate", () => {
    assert.equal("precision" in featureForRow(baseRow).properties, false);
    const approx = featureForRow({ ...baseRow, location_precision: "approximate" });
    assert.equal(approx.properties.precision, "approximate");
  });

  test("writes has_reports as the number 1, matching the map's to-number filter", () => {
    assert.equal("has_reports" in featureForRow(baseRow).properties, false);
    const reported = featureForRow({ ...baseRow, has_reports: true });
    assert.equal(reported.properties.has_reports, 1);
  });

  test("stamps tippecanoe minzoom on named features but not on fallback names", () => {
    assert.deepEqual(featureForRow(baseRow).tippecanoe, { minzoom: 0 });
    const unnamed = featureForRow({ ...baseRow, name: "Post office (unnamed)" });
    assert.equal(unnamed.tippecanoe, undefined);
  });

  test("returns null for a row with unusable coordinates", () => {
    assert.equal(featureForRow({ ...baseRow, lng: null }), null);
    assert.equal(featureForRow({ ...baseRow, lat: "not-a-number" }), null);
  });
});
