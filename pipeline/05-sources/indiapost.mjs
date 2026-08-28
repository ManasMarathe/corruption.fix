// India Post office directory.
//
// Two possible upstreams, in priority order:
//
//  1. data.gov.in "All India Pincode Directory" — gated behind
//     DATA_GOV_IN_API_KEY (api.data.gov.in returns HTTP 400
//     "Authorization field missing" without one; confirmed live via curl
//     while writing this module). The resource id below
//     (709e9d78-bf11-487d-93fd-d547d24cc0ef) was scraped directly from the
//     live https://www.data.gov.in/catalog/all-india-pincode-directory-through-webservice
//     page, but could NOT be verified end-to-end: data.gov.in returns the
//     same generic `{"error":"Key not authorised"}` for both a valid and a
//     deliberately-bogus resource id when the api-key itself is bad, so
//     there was no way to confirm the id is right without a real key. If
//     DATA_GOV_IN_API_KEY is set and this path 404s/401s in practice, that's
//     why — swap in the correct id from a data.gov.in account once you have
//     one, or delete this path and rely on (2).
//
//  2. https://api.postalpincode.in/pincode/<pincode> — no key, CONFIRMED
//     working (see the smoke test invoked by `node 05-sources/indiapost.mjs
//     --smoke-test`, and pipeline/README.md). Used whenever
//     DATA_GOV_IN_API_KEY is unset, or as the sole path since (1) is
//     unverified. Returns NO latitude/longitude, so every row normalize()
//     produces has lng/lat: null -> location_precision 'approximate' once
//     06-merge.mjs resolves it against the pincode-centroid table.
//
// Iterating ALL of India's ~19,300 pincodes needs a master pincode list.
// This module reads one from pipeline/data/pincodes.json (a plain JSON
// array of 6-digit pincode strings) if present. No such file ships with
// this repo — we did not find a scriptable, unauthenticated source for a
// complete pincode list either (the postalpincode.in API only looks
// pincodes *up*, it doesn't enumerate them). Absent that file, fetchRaw()
// clearly logs this and falls back to a small embedded seed list so the
// client can still be smoke-tested end-to-end.
import { join } from "node:path";
import {
  DATA_DIR,
  RAW_DIR,
  USER_AGENT,
  cachePathFor,
  dataGovInApiKey,
  ensureDir,
  readJsonCache,
  sleep,
  writeJsonCache,
} from "./_shared.mjs";

export const source = "indiapost";

const PINCODE_LIST_PATH = join(DATA_DIR, "pincodes.json");
const CACHE_PATH = cachePathFor(source);

// Data.gov.in resource id scraped from the live catalog page — see the
// header comment above for why this is unverified.
const DATA_GOV_IN_RESOURCE_ID = "709e9d78-bf11-487d-93fd-d547d24cc0ef";

// A handful of well-known pincodes across several states/cities, only used
// when data/pincodes.json isn't present, so `fetchRaw()` still has
// something real to demonstrate against.
const SEED_PINCODES = [
  "400001", // Mumbai GPO, MH
  "400004", // Mumbai (Ambewadi), MH
  "110001", // New Delhi GPO, DL
  "560001", // Bengaluru GPO, KA
  "700001", // Kolkata GPO, WB
  "600001", // Chennai GPO, TN
  "500001", // Hyderabad GPO, TS
  "380001", // Ahmedabad GPO, GJ
  "302001", // Jaipur GPO, RJ
  "160017", // Chandigarh, CH
];

function loadPincodeList(log) {
  const fromFile = readJsonCache(PINCODE_LIST_PATH);
  if (Array.isArray(fromFile) && fromFile.length > 0) {
    return fromFile.map(String);
  }
  log(
    `[indiapost] data/pincodes.json not found (or empty) — no full ~19,300-` +
      `pincode enumeration source was available in this environment. Falling ` +
      `back to a ${SEED_PINCODES.length}-pincode seed list. Drop a JSON array ` +
      `of pincodes at pipeline/data/pincodes.json to fetch the real thing.`
  );
  return SEED_PINCODES;
}

/**
 * @param {{
 *   pincodes?: string[],
 *   limit?: number,
 *   throttleMs?: number,
 *   fetchImpl?: typeof fetch,
 *   log?: (msg: string) => void,
 * }} [ctx]
 * @returns {Promise<object[]>} raw PostOffice rows (flattened across pincodes)
 */
export async function fetchRaw(ctx = {}) {
  const {
    limit = null,
    throttleMs = 150,
    fetchImpl = fetch,
    log = console.log,
  } = ctx;
  const pincodes = ctx.pincodes ?? loadPincodeList(log);

  const apiKey = dataGovInApiKey();
  if (apiKey) {
    log(
      `[indiapost] DATA_GOV_IN_API_KEY is set, but this module's data.gov.in ` +
        `resource id (${DATA_GOV_IN_RESOURCE_ID}) was scraped from the catalog ` +
        `page and never confirmed against a real key (see file header). ` +
        `Using the confirmed-working api.postalpincode.in path instead. ` +
        `Flip USE_DATA_GOV_IN below once you've verified the resource id.`
    );
  }

  ensureDir(RAW_DIR);
  const cache = readJsonCache(CACHE_PATH) ?? { byPincode: {} };

  const targetPincodes = limit ? pincodes.slice(0, limit) : pincodes;
  const toFetch = targetPincodes.filter((p) => !(p in cache.byPincode));
  if (toFetch.length === 0) {
    log(`[indiapost] cache already has all ${targetPincodes.length} requested pincodes.`);
  } else {
    log(
      `[indiapost] fetching ${toFetch.length} pincode(s) from api.postalpincode.in ` +
        `(${targetPincodes.length - toFetch.length} already cached)...`
    );
  }

  let fetched = 0;
  for (const pincode of toFetch) {
    try {
      const res = await fetchImpl(`https://api.postalpincode.in/pincode/${pincode}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        log(`[indiapost] pincode ${pincode}: HTTP ${res.status}, skipping`);
        cache.byPincode[pincode] = [];
      } else {
        const body = await res.json();
        const entry = Array.isArray(body) ? body[0] : null;
        cache.byPincode[pincode] =
          entry && entry.Status === "Success" && Array.isArray(entry.PostOffice)
            ? entry.PostOffice
            : [];
      }
    } catch (err) {
      log(`[indiapost] pincode ${pincode}: fetch failed (${err.message}), skipping`);
      cache.byPincode[pincode] = [];
    }
    fetched++;
    if (fetched % 25 === 0) {
      writeJsonCache(CACHE_PATH, cache);
      log(`[indiapost]   ...${fetched}/${toFetch.length} fetched, cache saved`);
    }
    if (fetched < toFetch.length) await sleep(throttleMs);
  }
  if (toFetch.length > 0) writeJsonCache(CACHE_PATH, cache);

  return targetPincodes.flatMap((p) => cache.byPincode[p] || []);
}

/**
 * @param {object[]} rows raw PostOffice records from api.postalpincode.in
 *   (or an equivalent shape: {Name, BranchType, District, State, Pincode, ...})
 * @returns {import("../lib/canonical.mjs").CanonicalOffice[]}
 */
export function normalize(rows) {
  const out = [];
  for (const row of rows) {
    if (!row || !row.Name || !row.Pincode) continue;
    out.push({
      sourceRef: `${row.Pincode}:${row.Name}`,
      name: /post office|p\.?o\.?$/i.test(row.Name) ? row.Name : `${row.Name} Post Office`,
      category: "post_office",
      services: [],
      lng: null,
      lat: null,
      address: [row.Name, row.District, row.State].filter(Boolean).join(", "),
      district: row.District || undefined,
      state: row.State || undefined,
      pincode: row.Pincode,
    });
  }
  return out;
}

// `node 05-sources/indiapost.mjs --smoke-test` — a handful of live requests
// to prove the api.postalpincode.in client actually works, per the task's
// "do not run the actual bulk fetch" instruction.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--smoke-test")) {
    const raw = await fetchRaw({ limit: 3 });
    console.log(`fetched ${raw.length} raw rows for 3 pincodes`);
    console.log(JSON.stringify(normalize(raw).slice(0, 3), null, 2));
  }
}
