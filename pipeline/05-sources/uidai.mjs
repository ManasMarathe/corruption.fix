// UIDAI Aadhaar enrolment/update centers ("Aadhaar Seva Kendra" and the
// wider network of bank/post-office/BSNL Aadhaar counters).
//
// STUB — no working endpoint wired up. What was checked while writing this
// module (2026-08-28):
//   - api.data.gov.in requires DATA_GOV_IN_API_KEY (HTTP 400 without one,
//     confirmed via curl) — this blocks the data.gov.in path outright when
//     the key is unset, same as indiapost.mjs.
//   - Even with a key, no data.gov.in resource for Aadhaar *center
//     locations* (name/address/coordinates) could be found. The UIDAI
//     datasets actually published on data.gov.in
//     (data.gov.in/dataset-group-name/Aadhaar) are aggregated
//     enrolment/update *statistics* by pincode and age group — not a
//     directory of physical centers with addresses. That's a different
//     shape of data than what CanonicalOffice needs.
//   - uidai.gov.in's own "Locate an Enrolment Centre" tool
//     (uidai.gov.in -> My Aadhaar -> Locate an Enrolment Centre) is an
//     interactive, session-based web form, not a documented public API.
//
// So: normalize() below is fully implemented and unit-tested against a
// fixture (see uidai.test.mjs) against the shape such a directory would
// plausibly have if one becomes available, but fetchRaw() has nothing real
// to call and says so loudly rather than fabricating a URL.
export const source = "uidai";

/**
 * @param {{log?: (msg: string) => void}} [ctx]
 * @returns {Promise<object[]>}
 */
export async function fetchRaw(ctx = {}) {
  const log = ctx.log || console.log;
  const hasKey = Boolean(process.env.DATA_GOV_IN_API_KEY);
  log(
    `[uidai] SKIPPED: no verified endpoint for Aadhaar enrolment-center ` +
      `*locations* was found (data.gov.in only publishes aggregate ` +
      `enrolment statistics under this topic, not a center directory). ` +
      (hasKey
        ? `DATA_GOV_IN_API_KEY is set but unused by this module for that reason.`
        : `DATA_GOV_IN_API_KEY is also unset.`) +
      ` This is not a crash — see the comment at the top of ` +
      `pipeline/05-sources/uidai.mjs for what was checked.`
  );
  return [];
}

/**
 * Expected raw row shape, were a real directory to become available:
 * {name, address, district, state, pincode, lat?, lng?}
 * @param {object[]} rows
 * @returns {import("../lib/canonical.mjs").CanonicalOffice[]}
 */
export function normalize(rows) {
  const out = [];
  for (const row of rows) {
    if (!row || !row.name) continue;
    out.push({
      sourceRef: row.id ? String(row.id) : `${row.pincode || ""}:${row.name}`,
      name: row.name,
      category: "govt_office",
      services: ["aadhaar"],
      lng: typeof row.lng === "number" ? row.lng : null,
      lat: typeof row.lat === "number" ? row.lat : null,
      address: row.address || undefined,
      district: row.district || undefined,
      state: row.state || undefined,
      pincode: row.pincode || undefined,
    });
  }
  return out;
}
