#!/usr/bin/env node
// Step 6: merge government-dataset rows (pipeline/05-sources/*.mjs) into
// the `offices` table — deduping against what's already there (mostly
// OSM, via 03-import.mjs) AND against each other — then upsert idempotently
// on (source, source_ref) and write `office_services` rows.
//
// IMPORTANT — read pipeline/README.md's "Government-dataset import" section.
// Running this does NOT put anything new on the map by itself: the map
// reads web/public/tiles/offices.pmtiles, a static build artifact that only
// 04-tiles.sh (re-)generates. Re-run 04-tiles.sh and redeploy the archive
// after this script for imported offices to actually appear.
//
// Dedup policy (implemented in pipeline/lib/canonical.mjs, see its tests):
//   Tier A (geometric): isProbableDuplicate() — same category, matching
//     name, coordinates within 500m. Every existing `offices` row has real
//     coordinates (geom is NOT NULL in the schema), so this is the primary
//     check once a government row's own coordinates are resolved (see
//     below). It runs against a coarse in-memory geo-grid index, not a
//     linear scan.
//   Tier B (text, this file only — not part of canonical.mjs's tested API):
//     a defense-in-depth fallback for rows whose coordinates are only a
//     pincode centroid (`location_precision: 'approximate'`), where a
//     500m radius against an area centroid is unreliable — the real office
//     could easily be >500m from that centroid, or an unrelated OSM office
//     could coincidentally be <500m from it. Tier B matches on normalized
//     name (equal or containment) plus the government row's district
//     appearing in the existing office's free-text address. This is a
//     heuristic, not exact, precisely because `offices.district_id` is left
//     NULL by 03-import.mjs for v1 (no boundary geometries) so there's no
//     structured district join to lean on. A row is treated as a duplicate
//     if EITHER tier says so — false positives (skipping a genuinely new,
//     coincidentally-named office) are the safer failure mode than false
//     negatives (a second pin for a real office already on the map).
//
// A matched duplicate is never re-inserted: the existing row keeps its
// (source, id, geometry); chooseWinner() decides the merged name/services,
// which get written back via UPDATE, plus office_services rows for the
// union. A non-duplicate is INSERTed fresh, upserting on (source,
// source_ref) so re-running this script is safe.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  chooseWinner,
  isProbableDuplicate,
  normalizeName,
  resolveCoordinates,
} from "./lib/canonical.mjs";
import { DATA_DIR, ensureDir } from "./05-sources/_shared.mjs";
import * as indiapost from "./05-sources/indiapost.mjs";
import * as uidai from "./05-sources/uidai.mjs";
import * as parivahan from "./05-sources/parivahan.mjs";
import * as ecourts from "./05-sources/ecourts.mjs";

const SOURCE_MODULES = [indiapost, uidai, parivahan, ecourts];

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost:5432/corruptionfix";
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 5_000;

// ~2.2 degrees of lat/lng at India's latitudes is roughly 200-250km, WAY
// too coarse — we actually want ~0.02deg (~2.2km) cells so a 500m-radius
// duplicate check only ever needs to look at a 3x3 neighborhood of cells.
const GRID_SIZE_DEG = 0.02;

// ---------------------------------------------------------------------------
// pincode centroid table (open dataset, cached under pipeline/data/)
// ---------------------------------------------------------------------------

const PINCODE_CENTROIDS_PATH = join(DATA_DIR, "pincode-centroids.csv");
// GeoNames-derived India postal-code centroids (place_name, state,
// latitude, longitude), mirrored as a plain CSV. GeoNames data is CC BY
// 4.0 (https://www.geonames.org/export/). ~11,000 pincodes — a solid
// fraction of India's ~19,300, not exhaustive; pincodes missing from this
// table fall through to "leave un-inserted, log the count" per policy.
const PINCODE_CENTROIDS_URL =
  "https://raw.githubusercontent.com/sanand0/pincode/master/data/IN.csv";

function parseCsvLine(line) {
  // Same minimal quoted-CSV split as 03-import.mjs's parseCsvLine
  // (duplicated rather than imported — 06-merge.mjs doesn't touch
  // 03-import.mjs, which another agent owns).
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function ensurePincodeCentroids(log) {
  if (existsSync(PINCODE_CENTROIDS_PATH)) return;
  log(`[centroids] ${PINCODE_CENTROIDS_PATH} not found, downloading from ${PINCODE_CENTROIDS_URL} ...`);
  try {
    const res = await fetch(PINCODE_CENTROIDS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    ensureDir(DATA_DIR);
    writeFileSync(PINCODE_CENTROIDS_PATH, text, "utf8");
    log(`[centroids] downloaded and cached.`);
  } catch (err) {
    log(
      `[centroids] download failed (${err.message}). Coordinate-less rows ` +
        `this run will be left un-inserted rather than guessed.`
    );
  }
}

/** @returns {Map<string, {lng:number, lat:number}>} */
function loadPincodeCentroids(log) {
  const map = new Map();
  if (!existsSync(PINCODE_CENTROIDS_PATH)) return map;
  const lines = readFileSync(PINCODE_CENTROIDS_PATH, "utf8").trim().split("\n");
  for (const line of lines.slice(1)) {
    const [key, , , latStr, lngStr] = parseCsvLine(line);
    const pincode = (key || "").split("/")[1];
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (pincode && Number.isFinite(lat) && Number.isFinite(lng)) {
      map.set(pincode, { lng, lat });
    }
  }
  log(`[centroids] loaded ${map.size} pincode centroids.`);
  return map;
}

// ---------------------------------------------------------------------------
// in-memory dedup index (existing DB rows + rows inserted earlier this run)
// ---------------------------------------------------------------------------

function gridKey(lng, lat) {
  return `${Math.round(lng / GRID_SIZE_DEG)}:${Math.round(lat / GRID_SIZE_DEG)}`;
}

function nameKey(category, name) {
  const normalized = normalizeName(name);
  const firstToken = normalized.split(" ")[0] || "";
  return `${category}:${firstToken}`;
}

function createIndex() {
  return {
    bySourceRef: new Map(), // `${source}:${sourceRef}` -> entry
    byGeoCell: new Map(), // `${category}:${gridKey}` -> entry[]
    byNamePrefix: new Map(), // `${category}:${firstToken}` -> entry[]
  };
}

function addToIndex(index, entry) {
  if (entry.source && entry.sourceRef) {
    index.bySourceRef.set(`${entry.source}:${entry.sourceRef}`, entry);
  }
  // Only the entry's own cell is populated on write; findGeoCandidates()
  // scans the 3x3 neighborhood at lookup time instead.
  const cellKey = `${entry.category}:${gridKey(entry.lng, entry.lat)}`;
  if (!index.byGeoCell.has(cellKey)) index.byGeoCell.set(cellKey, []);
  index.byGeoCell.get(cellKey).push(entry);

  const nKey = nameKey(entry.category, entry.name);
  if (!index.byNamePrefix.has(nKey)) index.byNamePrefix.set(nKey, []);
  index.byNamePrefix.get(nKey).push(entry);
}

function findGeoCandidates(index, category, lng, lat) {
  const out = [];
  const cx = Math.round(lng / GRID_SIZE_DEG);
  const cy = Math.round(lat / GRID_SIZE_DEG);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const key = `${category}:${cx + dx}:${cy + dy}`;
      const bucket = index.byGeoCell.get(key);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function findNameCandidates(index, category, name) {
  return index.byNamePrefix.get(nameKey(category, name)) || [];
}

/**
 * @returns {object|null} the matching index entry, or null
 */
function findDuplicate(index, canonicalRow, resolved) {
  const compareRow = { ...canonicalRow, lng: resolved.lng, lat: resolved.lat };

  // Tier A: geometric.
  for (const candidate of findGeoCandidates(index, canonicalRow.category, resolved.lng, resolved.lat)) {
    if (isProbableDuplicate(candidate, compareRow)) return candidate;
  }

  // Tier B: text fallback, only meaningful when we don't trust the
  // resolved coordinates (pincode centroid, not the real office location).
  if (resolved.locationPrecision === "approximate" && canonicalRow.district) {
    const districtNorm = normalizeName(canonicalRow.district);
    for (const candidate of findNameCandidates(index, canonicalRow.category, canonicalRow.name)) {
      const nameMatches =
        normalizeName(candidate.name) === normalizeName(canonicalRow.name) ||
        normalizeName(candidate.name).includes(normalizeName(canonicalRow.name)) ||
        normalizeName(canonicalRow.name).includes(normalizeName(candidate.name));
      if (!nameMatches) continue;
      const addressNorm = normalizeName(candidate.address || "");
      if (districtNorm && addressNorm.includes(districtNorm)) return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function loadExistingIndex(sql, log) {
  const index = createIndex();
  const offices = await sql`
    SELECT id, name, category, source, source_ref, osm_id, address,
           ST_X(geom) AS lng, ST_Y(geom) AS lat
    FROM offices
  `;
  const servicesByOffice = new Map();
  for (const row of await sql`SELECT office_id, service FROM office_services`) {
    if (!servicesByOffice.has(row.office_id)) servicesByOffice.set(row.office_id, []);
    servicesByOffice.get(row.office_id).push(row.service);
  }
  for (const o of offices) {
    addToIndex(index, {
      id: o.id,
      name: o.name,
      category: o.category,
      source: o.source,
      sourceRef: o.source_ref,
      osmId: o.osm_id,
      address: o.address,
      lng: o.lng,
      lat: o.lat,
      services: servicesByOffice.get(o.id) || [],
    });
  }
  log(`[merge] indexed ${offices.length} existing offices for dedup.`);
  return index;
}

async function mergeSource(sql, mod, index, centroids, log) {
  log(`\n=== ${mod.source} ===`);
  const raw = await mod.fetchRaw({ log });
  const canonical = mod.normalize(raw);
  log(`[${mod.source}] ${raw.length} raw rows -> ${canonical.length} canonical offices`);

  let inserted = 0;
  let merged = 0;
  let skippedNoCoords = 0;
  let processed = 0;

  let insertBatch = [];
  let serviceBatch = [];

  async function flushInserts() {
    if (insertBatch.length === 0) return;
    await sql`
      INSERT INTO offices ${sql(
        insertBatch,
        "id",
        "name",
        "category",
        "geom",
        "address",
        "source",
        "source_ref",
        "location_precision",
        "status"
      )}
      ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
        name = excluded.name,
        geom = excluded.geom,
        address = excluded.address,
        location_precision = excluded.location_precision
    `;
    insertBatch = [];
  }

  async function flushServices() {
    if (serviceBatch.length === 0) return;
    await sql`
      INSERT INTO office_services ${sql(serviceBatch, "office_id", "service")}
      ON CONFLICT (office_id, service) DO NOTHING
    `;
    serviceBatch = [];
  }

  for (const row of canonical) {
    processed++;
    const resolved = resolveCoordinates(row, centroids);
    if (!resolved) {
      skippedNoCoords++;
      continue;
    }

    const existingKey = `${mod.source}:${row.sourceRef}`;
    const exactRerun = index.bySourceRef.get(existingKey);
    // Only look for a fuzzy cross-source/OSM duplicate when this exact
    // (source, source_ref) pair hasn't been imported before — a re-run of
    // the same source for the same upstream row is handled by the INSERT
    // ... ON CONFLICT upsert below, not the merge path.
    const crossDuplicate = exactRerun ? null : findDuplicate(index, row, resolved);

    if (crossDuplicate) {
      // Genuine cross-source/OSM duplicate: prefer the existing geometry,
      // merge in the government name/services, never insert a second row.
      merged++;
      const winner = chooseWinner(crossDuplicate, {
        ...row,
        source: mod.source,
        lng: resolved.lng,
        lat: resolved.lat,
      });
      await sql`
        UPDATE offices SET name = ${winner.name}, address = ${winner.address}
        WHERE id = ${crossDuplicate.id}
      `;
      for (const service of winner.services) {
        serviceBatch.push({ office_id: crossDuplicate.id, service });
      }
      crossDuplicate.name = winner.name;
      crossDuplicate.services = winner.services;
    } else {
      // Brand-new office, or a refresh of a row this same source already
      // upserted on a previous run (ON CONFLICT keeps its id, name, geom
      // and address current).
      const id = exactRerun ? exactRerun.id : uuidv7();
      insertBatch.push({
        id,
        name: row.name,
        category: row.category,
        geom: `SRID=4326;POINT(${resolved.lng} ${resolved.lat})`,
        address: row.address || null,
        source: mod.source,
        source_ref: row.sourceRef,
        location_precision: resolved.locationPrecision,
        status: "seeded",
      });
      for (const service of row.services) {
        serviceBatch.push({ office_id: id, service });
      }
      if (!exactRerun) {
        addToIndex(index, {
          id,
          name: row.name,
          category: row.category,
          source: mod.source,
          sourceRef: row.sourceRef,
          address: row.address,
          lng: resolved.lng,
          lat: resolved.lat,
          services: row.services,
        });
        inserted++;
      }
    }

    if (insertBatch.length >= BATCH_SIZE) await flushInserts();
    if (serviceBatch.length >= BATCH_SIZE) await flushServices();
    if (processed % PROGRESS_EVERY === 0) {
      log(`[${mod.source}]   ...${processed}/${canonical.length} processed (inserted ${inserted}, merged ${merged}, skipped-no-coords ${skippedNoCoords})`);
    }
  }
  await flushInserts();
  await flushServices();

  log(
    `[${mod.source}] done. inserted=${inserted} merged=${merged} ` +
      `skipped(no coords/no centroid match)=${skippedNoCoords}`
  );
  return { inserted, merged, skippedNoCoords };
}

async function main() {
  const log = (...args) => console.log(...args);
  console.log(`Connecting to ${DATABASE_URL} ...`);
  const sql = postgres(DATABASE_URL, { max: 5 });

  try {
    await ensurePincodeCentroids(log);
    const centroids = loadPincodeCentroids(log);
    const index = await loadExistingIndex(sql, log);

    const totals = { inserted: 0, merged: 0, skippedNoCoords: 0 };
    for (const mod of SOURCE_MODULES) {
      const result = await mergeSource(sql, mod, index, centroids, log);
      totals.inserted += result.inserted;
      totals.merged += result.merged;
      totals.skippedNoCoords += result.skippedNoCoords;
    }

    console.log("\nMerge complete.");
    console.log(`  new offices inserted: ${totals.inserted}`);
    console.log(`  merged into existing offices: ${totals.merged}`);
    console.log(`  skipped (no coordinates and no pincode-centroid match): ${totals.skippedNoCoords}`);
    console.log(
      "\nReminder: these rows are in Postgres now, but the map reads a static\n" +
        "web/public/tiles/offices.pmtiles file. Re-run `npm run tiles` (04-tiles.sh)\n" +
        "and redeploy that archive for anything imported here to appear on the map."
    );
  } finally {
    await sql.end();
  }
}

// Guarded (unlike 03-import.mjs's unconditional main()) so this module can
// be `import`ed — e.g. from a test — without opening a DB connection as a
// side effect. `node 06-merge.mjs` still runs it normally.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Exported so the dedup index/lookup logic (pure, no I/O) can be sanity
// checked without a database connection.
export {
  parseCsvLine,
  gridKey,
  nameKey,
  createIndex,
  addToIndex,
  findGeoCandidates,
  findNameCandidates,
  findDuplicate,
};
