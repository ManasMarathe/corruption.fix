import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchRaw, normalize, source } from "./ecourts.mjs";

describe("ecourts", () => {
  test("exports the correct source enum value", () => {
    assert.equal(source, "ecourts");
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
        establishmentCode: "MHCC01",
        complexName: "Mumbai City Civil and Sessions Court",
        address: "Fort",
        district: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        lat: 18.9339,
        lng: 72.8341,
      },
    ];
    const rows = normalize(fixture);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sourceRef, "MHCC01");
    assert.equal(rows[0].category, "court");
    assert.deepEqual(rows[0].services, []);
    assert.equal(rows[0].lat, 18.9339);
  });

  test("normalize falls back to pincode:complexName when establishmentCode is missing", () => {
    const rows = normalize([{ complexName: "Taluka Court, Kurla", pincode: "400070" }]);
    assert.equal(rows[0].sourceRef, "400070:Taluka Court, Kurla");
  });

  test("skips rows with no complexName", () => {
    assert.deepEqual(normalize([{ pincode: "400001" }, null]), []);
  });
});
