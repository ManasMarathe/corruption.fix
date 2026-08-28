import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchRaw, normalize, source } from "./parivahan.mjs";

describe("parivahan", () => {
  test("exports the correct source enum value", () => {
    assert.equal(source, "parivahan");
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
        rtoCode: "MH-01",
        name: "RTO Mumbai Central",
        address: "Tardeo Road",
        district: "Mumbai",
        state: "Maharashtra",
        pincode: "400034",
        lat: 18.9738,
        lng: 72.8146,
      },
    ];
    const rows = normalize(fixture);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceRef, "MH-01");
    assert.equal(rows[0].category, "rto");
    assert.deepEqual(rows[0].services, ["vehicle_registration", "driving_licence"]);
    assert.equal(rows[0].lng, 72.8146);
  });

  test("normalize falls back to pincode:name when rtoCode is missing", () => {
    const rows = normalize([{ name: "DTO Kurla", pincode: "400070" }]);
    assert.equal(rows[0].sourceRef, "400070:DTO Kurla");
    assert.equal(rows[0].lng, null);
  });

  test("skips rows with no name", () => {
    assert.deepEqual(normalize([{ pincode: "400001" }, null]), []);
  });
});
