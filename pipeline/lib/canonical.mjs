// Pure, dependency-free helpers for reconciling offices coming from
// government datasets (pipeline/05-sources/*.mjs) with what's already in the
// `offices` table (mostly OSM-sourced). No I/O, no network — everything here
// is unit-tested directly in canonical.test.mjs.
//
// @typedef {Object} CanonicalOffice
// @property {string} sourceRef  stable upstream id, unique within its source
// @property {string} name
// @property {"police"|"post_office"|"court"|"govt_office"|"rto"|"other"} category
// @property {string[]} services  subset of OFFICE_SERVICES (web/src/db/schema.ts)
// @property {number|null} lng
// @property {number|null} lat
// @property {string} [address]
// @property {string} [district]
// @property {string} [state]
// @property {string} [pincode]

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------

// Standalone "PO" / "P.O." (not part of an already-spelled-out word like
// "post") -> "post office". Word-boundaried so it never matches inside
// "post", "police", etc.
const RE_PO = /\bp\.?\s*o\.?\b/g;
const RE_PS = /\bp\.?\s*s\.?\b/g;
const RE_GOVT = /\bgovt\.?\b/g;
const RE_DIST = /\bdist\.?\b/g;

// Punctuation to drop once abbreviation expansion has happened (periods,
// commas, and the usual assortment of separators/brackets).
const RE_PUNCT = /[.,/#!$%^&*;:{}=\-_`~()]/g;

// Runs of two-or-more single-letter words ("v p" from "V P Road", or what
// "V.P." becomes after punctuation is stripped down to "v p") are almost
// always initials that should be read as one token, e.g. "vp" — matching
// how "V.P." collapses to "vp" once its periods are simply removed.
const RE_INITIALS = /\b(?:[a-z]\s+)+[a-z]\b/g;

/**
 * Canonical form of an office name for equality/containment matching.
 * Case-, punctuation-, and whitespace-insensitive, and folds the common
 * govt-office abbreviations (PO/P.O./Post Office, PS/P.S./Police Station,
 * Govt/Government, Dist/District) to the same token so e.g. "V.P. Road
 * P.O.", "VP Road Post Office", and "V P Road PO" all normalize equal.
 * @param {string} name
 * @returns {string}
 */
export function normalizeName(name) {
  if (!name) return "";
  let s = String(name).toLowerCase();
  s = s.replace(RE_PO, "post office");
  s = s.replace(RE_PS, "police station");
  s = s.replace(RE_GOVT, "government");
  s = s.replace(RE_DIST, "district");
  s = s.replace(RE_PUNCT, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(RE_INITIALS, (m) => m.replace(/\s+/g, ""));
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ---------------------------------------------------------------------------
// haversineMeters
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two {lng,lat} points, in meters.
 * @param {{lng:number, lat:number}} a
 * @param {{lng:number, lat:number}} b
 * @returns {number}
 */
export function haversineMeters(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

const DUPLICATE_RADIUS_M = 500;

function hasCoords(o) {
  return o.lng != null && o.lat != null;
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * True when two offices (from any mix of sources) are probably the same
 * real-world place. Rules:
 *   - same `category`, AND
 *   - normalized names equal, or one contains the other, AND
 *   - either both have coordinates and are within 500m of each other,
 *     or neither has coordinates and they share a pincode or district.
 * @param {Partial<CanonicalOffice>} a
 * @param {Partial<CanonicalOffice>} b
 * @returns {boolean}
 */
export function isProbableDuplicate(a, b) {
  if (a.category !== b.category) return false;
  if (!namesMatch(a.name, b.name)) return false;

  const aHas = hasCoords(a);
  const bHas = hasCoords(b);

  if (aHas && bHas) {
    return haversineMeters(a, b) <= DUPLICATE_RADIUS_M;
  }
  if (!aHas && !bHas) {
    const pincodeMatch = Boolean(a.pincode && b.pincode && a.pincode === b.pincode);
    const districtMatch = Boolean(
      a.district && b.district && normalizeName(a.district) === normalizeName(b.district)
    );
    return pincodeMatch || districtMatch;
  }
  // One has coordinates and the other doesn't: not enough signal either way.
  return false;
}

// ---------------------------------------------------------------------------
// chooseWinner
// ---------------------------------------------------------------------------

/**
 * Merge policy for a matched (osmOffice, govOffice) pair.
 *
 * - Geometry: OSM wins (it's `location_precision: 'exact'`; the government
 *   row is usually `'approximate'`, sourced from a pincode centroid).
 * - Name: the government row wins (authoritative — OSM naming for Indian
 *   govt offices is inconsistent/crowdsourced).
 * - Services: union of both.
 * - Both source refs are kept (as a map keyed by source) so the merge is
 *   traceable even though the `offices` table only persists one
 *   `(source, source_ref)` pair per row — it's up to the caller (06-merge.mjs)
 *   to decide how much of that to persist.
 *
 * @param {Partial<CanonicalOffice> & {source?: string, sourceRef?: string|null, osmId?: number|null}} osmOffice
 * @param {Partial<CanonicalOffice> & {source: string}} govOffice
 */
export function chooseWinner(osmOffice, govOffice) {
  const services = Array.from(
    new Set([...(osmOffice.services || []), ...(govOffice.services || [])])
  );
  return {
    name: govOffice.name,
    category: osmOffice.category ?? govOffice.category,
    lng: osmOffice.lng,
    lat: osmOffice.lat,
    address: govOffice.address ?? osmOffice.address ?? null,
    services,
    sourceRefs: {
      [osmOffice.source || "osm"]: osmOffice.sourceRef ?? osmOffice.osmId ?? null,
      [govOffice.source]: govOffice.sourceRef ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// pincode centroid fallback
// ---------------------------------------------------------------------------

/**
 * Resolve a CanonicalOffice with no coordinates to a pincode centroid.
 * Pure function — `centroidsByPincode` is a plain Map/object of
 * `pincode -> {lng, lat}` that the caller loads (see 06-merge.mjs, which
 * sources it from pipeline/data/pincode-centroids.csv).
 *
 * Returns `null` (does NOT guess) when the office already has coordinates
 * is missing a pincode, or the pincode isn't in the centroid table — the
 * caller is expected to leave such rows un-inserted and log the count
 * rather than fabricate a coordinate.
 *
 * @param {Partial<CanonicalOffice>} office
 * @param {Map<string, {lng:number, lat:number}>|Record<string, {lng:number, lat:number}>} centroidsByPincode
 * @returns {{lng:number, lat:number, locationPrecision: 'exact'|'approximate'}|null}
 */
export function resolveCoordinates(office, centroidsByPincode) {
  if (hasCoords(office)) {
    return { lng: office.lng, lat: office.lat, locationPrecision: "exact" };
  }
  if (!office.pincode) return null;
  const centroid =
    centroidsByPincode instanceof Map
      ? centroidsByPincode.get(String(office.pincode))
      : centroidsByPincode[String(office.pincode)];
  if (!centroid) return null;
  return {
    lng: centroid.lng,
    lat: centroid.lat,
    locationPrecision: "approximate",
  };
}
