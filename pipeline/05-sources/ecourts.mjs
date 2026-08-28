// eCourts district/taluka court complex directory.
//
// STUB — no working endpoint wired up. What was checked while writing this
// module (2026-08-28): services.ecourts.gov.in ("eCourts Services") is the
// official portal and does drive a state -> district -> court-complex
// picker, which implies *some* internal JSON endpoint backs it, but nothing
// documented/stable was found to call directly. Third-party wrappers exist
// (e.g. an "E-Courts India API" now hosted at court-api.kleopatra.io) but
// they're paid/rate-limited products layered over scraped eCourts data, not
// a government-published open dataset or API — using one wasn't treated as
// "a real, working endpoint" for this task, since it isn't an authoritative
// source and its availability/terms weren't verifiable here. No
// data.gov.in resource for a court-complex directory was found either.
//
// normalize() below is fully implemented and unit-tested against a fixture
// (see ecourts.test.mjs) against the shape such a directory would plausibly
// have. fetchRaw() reports the gap rather than fabricating a URL.
export const source = "ecourts";

/**
 * @param {{log?: (msg: string) => void}} [ctx]
 * @returns {Promise<object[]>}
 */
export async function fetchRaw(ctx = {}) {
  const log = ctx.log || console.log;
  log(
    `[ecourts] SKIPPED: no verified government-published endpoint for the ` +
      `court-complex directory was found (services.ecourts.gov.in backs its ` +
      `own UI with an undocumented internal API; only paid third-party ` +
      `wrappers were found, not treated as authoritative). This is not a ` +
      `crash — see the comment at the top of pipeline/05-sources/ecourts.mjs ` +
      `for what was checked.`
  );
  return [];
}

/**
 * Expected raw row shape, were a real directory to become available:
 * {complexName, establishmentCode, address, district, state, pincode, lat?, lng?}
 * @param {object[]} rows
 * @returns {import("../lib/canonical.mjs").CanonicalOffice[]}
 */
export function normalize(rows) {
  const out = [];
  for (const row of rows) {
    if (!row || !row.complexName) continue;
    out.push({
      sourceRef: row.establishmentCode
        ? String(row.establishmentCode)
        : `${row.pincode || ""}:${row.complexName}`,
      name: row.complexName,
      category: "court",
      services: [],
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
