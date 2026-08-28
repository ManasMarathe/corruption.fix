import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalize, source } from "./indiapost.mjs";

const FIXTURE = [
  {
    Name: "Ambewadi",
    BranchType: "Sub Post Office",
    DeliveryStatus: "Delivery",
    Circle: "Maharashtra",
    District: "Mumbai",
    Division: "Mumbai South",
    Region: "Mumbai",
    Block: "Mumbai",
    State: "Maharashtra",
    Country: "India",
    Pincode: "400004",
  },
  {
    Name: "Mumbai GPO",
    BranchType: "Head Post Office",
    DeliveryStatus: "Delivery",
    Circle: "Maharashtra",
    District: "Mumbai",
    Division: "Mumbai GPO",
    Region: "Mumbai",
    Block: "Mumbai",
    State: "Maharashtra",
    Country: "India",
    Pincode: "400001",
  },
];

describe("indiapost.normalize", () => {
  test("exports the correct source enum value", () => {
    assert.equal(source, "indiapost");
  });

  test("maps postalpincode.in rows to CanonicalOffice shape", () => {
    const rows = normalize(FIXTURE);
    assert.equal(rows.length, 2);

    assert.equal(rows[0].sourceRef, "400004:Ambewadi");
    assert.equal(rows[0].category, "post_office");
    assert.equal(rows[0].lng, null);
    assert.equal(rows[0].lat, null);
    assert.equal(rows[0].pincode, "400004");
    assert.equal(rows[0].district, "Mumbai");
    assert.equal(rows[0].state, "Maharashtra");
  });

  test("appends 'Post Office' to names that don't already say so", () => {
    const rows = normalize(FIXTURE);
    assert.equal(rows[0].name, "Ambewadi Post Office");
  });

  test("does not double-append when the name already says Post Office / PO", () => {
    const rows = normalize([{ ...FIXTURE[1], Name: "Mumbai GPO Post Office" }]);
    assert.equal(rows[0].name, "Mumbai GPO Post Office");
  });

  test("skips rows missing a name or pincode", () => {
    const rows = normalize([{ Name: "No Pincode Here" }, { Pincode: "400004" }, null]);
    assert.equal(rows.length, 0);
  });
});
