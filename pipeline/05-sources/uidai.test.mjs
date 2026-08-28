import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchRaw, normalize, source } from "./uidai.mjs";

describe("uidai", () => {
  test("exports the correct source enum value", () => {
    assert.equal(source, "uidai");
  });

  test("fetchRaw skips cleanly (no network, no throw) and logs why", async () => {
    const logs = [];
    const rows = await fetchRaw({ log: (m) => logs.push(m) });
    assert.deepEqual(rows, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /SKIPPED/);
  });

  test("normalize maps a plausible fixture to CanonicalOffice shape", () => {
    const fixture = [
      {
        id: "ASK-MUM-001",
        name: "Aadhaar Seva Kendra, Bandra",
        address: "Linking Road, Bandra West",
        district: "Mumbai",
        state: "Maharashtra",
        pincode: "400050",
        lat: 19.0596,
        lng: 72.8295,
      },
    ];
    const rows = normalize(fixture);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceRef, "ASK-MUM-001");
    assert.equal(rows[0].category, "govt_office");
    assert.deepEqual(rows[0].services, ["aadhaar"]);
    assert.equal(rows[0].lng, 72.8295);
    assert.equal(rows[0].lat, 19.0596);
  });

  test("normalize falls back to pincode:name when id is missing, and null coords when absent", () => {
    const rows = normalize([{ name: "Bank Aadhaar Counter", pincode: "400001" }]);
    assert.equal(rows[0].sourceRef, "400001:Bank Aadhaar Counter");
    assert.equal(rows[0].lng, null);
    assert.equal(rows[0].lat, null);
  });

  test("skips rows with no name", () => {
    assert.deepEqual(normalize([{ pincode: "400001" }, null]), []);
  });
});
