import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName,
  haversineMeters,
  isProbableDuplicate,
  chooseWinner,
  resolveCoordinates,
} from "./canonical.mjs";

describe("normalizeName", () => {
  test("PO / P.O. / Post Office all collapse to the same string", () => {
    const variants = ["V.P. Road P.O.", "VP Road Post Office", "V P Road PO"];
    const normalized = variants.map(normalizeName);
    assert.equal(normalized[0], normalized[1]);
    assert.equal(normalized[1], normalized[2]);
    assert.equal(normalized[0], "vp road post office");
  });

  test("PS / P.S. / Police Station all collapse to the same string", () => {
    const variants = [
      "Andheri P.S.",
      "Andheri Police Station",
      "Andheri PS",
    ];
    const normalized = variants.map(normalizeName);
    assert.equal(normalized[0], normalized[1]);
    assert.equal(normalized[1], normalized[2]);
    assert.equal(normalized[0], "andheri police station");
  });

  test("Govt / Government collapse to the same string", () => {
    assert.equal(
      normalizeName("Govt. Hospital Dist. Office"),
      normalizeName("Government Hospital District Office")
    );
  });

  test("Dist / District collapse to the same string", () => {
    assert.equal(normalizeName("Pune Dist. Court"), normalizeName("Pune District Court"));
  });

  test("case and whitespace insensitive", () => {
    assert.equal(normalizeName("  Mumbai   GPO  "), normalizeName("mumbai gpo"));
  });

  test("empty/nullish input yields empty string", () => {
    assert.equal(normalizeName(""), "");
    assert.equal(normalizeName(undefined), "");
    assert.equal(normalizeName(null), "");
  });

  test("does not falsely expand substrings of unrelated words", () => {
    // "post" and "police" both contain a "p"+"o" pair adjacent to more
    // letters; RE_PO/RE_PS must not fire on them.
    assert.equal(normalizeName("Post Graduate Office"), "post graduate office");
    assert.equal(normalizeName("Police Commissionerate"), "police commissionerate");
  });
});

describe("haversineMeters", () => {
  test("distance between the same point is zero", () => {
    const p = { lng: 72.8347, lat: 18.9322 };
    assert.equal(haversineMeters(p, p), 0);
  });

  test("known distance: two points ~1km apart (roughly)", () => {
    // Two points on the same meridian, 0.009 degrees of latitude apart
    // (~1km at the equator-ish; India is close enough for a loose bound).
    const a = { lng: 72.8347, lat: 18.9322 };
    const b = { lng: 72.8347, lat: 18.9412 };
    const d = haversineMeters(a, b);
    assert.ok(d > 900 && d < 1100, `expected ~1000m, got ${d}`);
  });
});

describe("isProbableDuplicate", () => {
  const osmVpRoadPS = {
    category: "police",
    name: "VP Road Police Station",
    lng: 72.8296,
    lat: 18.9469,
  };

  test("India Post row matching an existing OSM office -> true (same category, matching name, within 500m)", () => {
    const govRow = {
      category: "post_office",
      name: "V.P. Road P.O.",
      lng: 72.83,
      lat: 18.947,
    };
    const osmPostOffice = {
      category: "post_office",
      name: "VP Road Post Office",
      lng: 72.8296,
      lat: 18.9469,
    };
    assert.equal(isProbableDuplicate(osmPostOffice, govRow), true);
  });

  test("different office 2km away -> false", () => {
    const farAway = {
      category: "police",
      name: "VP Road Police Station",
      // ~2km north
      lng: 72.8296,
      lat: 18.9649,
    };
    assert.equal(isProbableDuplicate(osmVpRoadPS, farAway), false);
  });

  test("same name, different category -> false", () => {
    const samePlacePostOffice = {
      category: "post_office",
      name: "VP Road Police Station",
      lng: 72.8296,
      lat: 18.9469,
    };
    assert.equal(isProbableDuplicate(osmVpRoadPS, samePlacePostOffice), false);
  });

  test("no coordinates on either side: matches on shared pincode", () => {
    const a = { category: "post_office", name: "Ambewadi P.O.", pincode: "400004" };
    const b = { category: "post_office", name: "Ambewadi Post Office", pincode: "400004" };
    assert.equal(isProbableDuplicate(a, b), true);
  });

  test("no coordinates on either side: different pincode and district -> false", () => {
    const a = {
      category: "post_office",
      name: "Ambewadi P.O.",
      pincode: "400004",
      district: "Mumbai",
    };
    const b = {
      category: "post_office",
      name: "Ambewadi Post Office",
      pincode: "411001",
      district: "Pune",
    };
    assert.equal(isProbableDuplicate(a, b), false);
  });

  test("one has coordinates, the other doesn't -> false (not enough signal)", () => {
    const a = { category: "post_office", name: "Ambewadi P.O.", lng: 72.8, lat: 18.9 };
    const b = { category: "post_office", name: "Ambewadi Post Office", pincode: "400004" };
    assert.equal(isProbableDuplicate(a, b), false);
  });

  test("name containment counts as a match (one contains the other)", () => {
    const a = { category: "court", name: "Pune District Court", lng: 73.85, lat: 18.52 };
    const b = { category: "court", name: "Pune Dist. Court Complex", lng: 73.8501, lat: 18.5201 };
    assert.equal(isProbableDuplicate(a, b), true);
  });
});

describe("chooseWinner", () => {
  test("OSM geometry wins, government name wins, services are unioned, both refs kept", () => {
    const osmOffice = {
      source: "osm",
      osmId: 12345,
      sourceRef: null,
      name: "VP Rd PS",
      category: "police",
      lng: 72.8296,
      lat: 18.9469,
      services: ["fir"],
    };
    const govOffice = {
      source: "police",
      sourceRef: "MH-POLICE-9182",
      name: "V.P. Road Police Station",
      category: "police",
      lng: 72.83,
      lat: 18.947,
      services: ["fir", "land_records"],
    };

    const merged = chooseWinner(osmOffice, govOffice);

    assert.equal(merged.name, "V.P. Road Police Station");
    assert.equal(merged.lng, osmOffice.lng);
    assert.equal(merged.lat, osmOffice.lat);
    assert.deepEqual(new Set(merged.services), new Set(["fir", "land_records"]));
    assert.equal(merged.sourceRefs.osm, 12345);
    assert.equal(merged.sourceRefs.police, "MH-POLICE-9182");
  });
});

describe("resolveCoordinates (pincode-centroid fallback)", () => {
  const centroids = new Map([["400004", { lng: 72.8172, lat: 18.9548 }]]);

  test("office already has coordinates -> passed through as exact", () => {
    const office = { lng: 72.8, lat: 18.9, pincode: "400004" };
    const resolved = resolveCoordinates(office, centroids);
    assert.deepEqual(resolved, { lng: 72.8, lat: 18.9, locationPrecision: "exact" });
  });

  test("no coordinates, pincode found in centroid table -> approximate", () => {
    const office = { lng: null, lat: null, pincode: "400004" };
    const resolved = resolveCoordinates(office, centroids);
    assert.deepEqual(resolved, {
      lng: 72.8172,
      lat: 18.9548,
      locationPrecision: "approximate",
    });
  });

  test("no coordinates, pincode not in centroid table -> null (never guesses)", () => {
    const office = { lng: null, lat: null, pincode: "999999" };
    assert.equal(resolveCoordinates(office, centroids), null);
  });

  test("no coordinates and no pincode -> null", () => {
    const office = { lng: null, lat: null };
    assert.equal(resolveCoordinates(office, centroids), null);
  });

  test("works with a plain object as well as a Map", () => {
    const office = { lng: null, lat: null, pincode: "400004" };
    const resolved = resolveCoordinates(office, { "400004": { lng: 72.8172, lat: 18.9548 } });
    assert.equal(resolved.locationPrecision, "approximate");
  });
});
