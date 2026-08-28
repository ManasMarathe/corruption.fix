// Parivahan Sewa RTO/DTO (Regional/District Transport Office) directory.
//
// STUB — no working endpoint wired up. What was checked while writing this
// module (2026-08-28): parivahan.gov.in and its Vahan/Sarathi services are
// interactive portals (state -> RTO dropdown search UIs, and an analytics
// dashboard at analytics.parivahan.gov.in for aggregate vehicle-registration
// counts) — nothing that publishes a scriptable, addressable RTO-office
// directory (name/address/coordinates) via data.gov.in or a documented API.
// No DATA_GOV_IN_API_KEY-gated resource for this was found either, so this
// module isn't blocked by the key — there's simply no endpoint yet.
//
// normalize() below is fully implemented and unit-tested against a fixture
// (see parivahan.test.mjs) against the shape such a directory would
// plausibly have. fetchRaw() reports the gap rather than fabricating a URL.
export const source = "parivahan";

/**
 * @param {{log?: (msg: string) => void}} [ctx]
 * @returns {Promise<object[]>}
 */
export async function fetchRaw(ctx = {}) {
  const log = ctx.log || console.log;
  log(
    `[parivahan] SKIPPED: no scriptable RTO/DTO office directory endpoint ` +
      `(open dataset or documented API) was found — parivahan.gov.in is an ` +
      `interactive portal, not an API. This is not a crash — see the comment ` +
      `at the top of pipeline/05-sources/parivahan.mjs for what was checked.`
  );
  return [];
}

/**
 * Expected raw row shape, were a real directory to become available:
 * {name, rtoCode, address, district, state, pincode, lat?, lng?}
 * @param {object[]} rows
 * @returns {import("../lib/canonical.mjs").CanonicalOffice[]}
 */
export function normalize(rows) {
  const out = [];
  for (const row of rows) {
    if (!row || !row.name) continue;
    out.push({
      sourceRef: row.rtoCode ? String(row.rtoCode) : `${row.pincode || ""}:${row.name}`,
      name: row.name,
      category: "rto",
      services: ["vehicle_registration", "driving_licence"],
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
