#!/usr/bin/env node
// Step 3: stream data/india-offices.geojsonseq into the `offices` table
// (and data/states.json + data/districts.csv into `states`/`districts`
// first). Never loads the full GeoJSON file into memory — reads it
// line-by-line and inserts in batches.
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { osmUid } from "./lib/osmuid.mjs";
import {
  extractIdType,
  categoryFor,
  nameFor,
  addressFor,
  centroidOfGeometry,
} from "./lib/office-tags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const GEOJSONSEQ_PATH = join(DATA_DIR, "india-offices.geojsonseq");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost:5432/corruptionfix";
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 10_000;

const sql = postgres(DATABASE_URL, { max: 5 });

// ---------------------------------------------------------------------------
// states / districts
// ---------------------------------------------------------------------------

async function importStatesAndDistricts() {
  const states = JSON.parse(
    readFileSync(join(DATA_DIR, "states.json"), "utf8")
  );
  console.log(`states.json: ${states.length} rows`);

  const stateRows = states.map((s) => ({
    id: uuidv7(),
    lgd_code: s.lgd_code,
    name: s.name,
  }));
  for (const chunk of chunks(stateRows, BATCH_SIZE)) {
    await sql`
      INSERT INTO states ${sql(chunk, "id", "lgd_code", "name")}
      ON CONFLICT (lgd_code) DO UPDATE SET name = excluded.name
    `;
  }

  const stateIdByLgdCode = new Map(
    (await sql`SELECT id, lgd_code FROM states`).map((r) => [
      r.lgd_code,
      r.id,
    ])
  );

  const districtsCsv = readFileSync(
    join(DATA_DIR, "districts.csv"),
    "utf8"
  ).trim();
  const [, ...districtLines] = districtsCsv.split("\n");
  const districtRows = districtLines.map((line) => {
    const [lgdCode, stateLgdCode, ...nameParts] = parseCsvLine(line);
    const stateId = stateIdByLgdCode.get(Number(stateLgdCode));
    if (!stateId) {
      throw new Error(`districts.csv: unknown state_lgd_code ${stateLgdCode}`);
    }
    return {
      id: uuidv7(),
      lgd_code: Number(lgdCode),
      name: nameParts.join(","),
      state_id: stateId,
    };
  });
  console.log(`districts.csv: ${districtRows.length} rows`);
  for (const chunk of chunks(districtRows, BATCH_SIZE)) {
    await sql`
      INSERT INTO districts ${sql(chunk, "id", "lgd_code", "name", "state_id")}
      ON CONFLICT (lgd_code) DO UPDATE SET name = excluded.name, state_id = excluded.state_id
    `;
  }

  const [{ count: stateCount }] = await sql`SELECT count(*)::int FROM states`;
  const [{ count: districtCount }] =
    await sql`SELECT count(*)::int FROM districts`;
  console.log(`  states table now has ${stateCount} rows`);
  console.log(`  districts table now has ${districtCount} rows`);
}

function parseCsvLine(line) {
  // Minimal CSV split good enough for our generated data (only district
  // names containing a comma are quoted, e.g. `"Foo, Bar"`).
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// offices
// ---------------------------------------------------------------------------

async function importOffices() {
  const stream = createReadStream(GEOJSONSEQ_PATH, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch = [];
  let processed = 0;
  let inserted = 0;
  let skippedNoCategory = 0;
  let skippedNoGeom = 0;
  let skippedBadId = 0;
  const counts = {};

  async function flush() {
    if (batch.length === 0) return;
    await sql`
      INSERT INTO offices ${sql(
        batch,
        "id",
        "name",
        "category",
        "geom",
        "address",
        "source",
        "osm_id",
        "status"
      )}
      ON CONFLICT (osm_id) DO UPDATE SET
        name = excluded.name,
        geom = excluded.geom,
        address = excluded.address
    `;
    inserted += batch.length;
    batch = [];
  }

  for await (const rawLine of rl) {
    // GeoJSONSeq (RFC 8142) lines may be prefixed with RS (0x1E).
    const line = rawLine.charCodeAt(0) === 0x1e ? rawLine.slice(1) : rawLine;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let feature;
    try {
      feature = JSON.parse(trimmed);
    } catch {
      skippedBadId++;
      continue;
    }
    processed++;

    const tags = feature.properties || {};
    const category = categoryFor(tags);
    if (!category) {
      skippedNoCategory++;
    } else {
      const point = centroidOfGeometry(feature.geometry);
      const idType = extractIdType(feature);
      if (!point) {
        skippedNoGeom++;
      } else if (!idType) {
        skippedBadId++;
      } else {
        const osmId = osmUid(idType.type, idType.id);
        batch.push({
          id: uuidv7(),
          name: nameFor(tags, category),
          category,
          geom: `SRID=4326;POINT(${point.lng} ${point.lat})`,
          address: addressFor(tags),
          source: "osm",
          osm_id: osmId,
          status: "seeded",
        });
        counts[category] = (counts[category] || 0) + 1;
        if (batch.length >= BATCH_SIZE) await flush();
      }
    }

    if (processed % PROGRESS_EVERY === 0) {
      console.log(
        `  processed ${processed} features, inserted/updated ${inserted} so far`
      );
    }
  }
  await flush();

  console.log(`\nOffices import complete.`);
  console.log(`  features processed: ${processed}`);
  console.log(`  upserted: ${inserted}`);
  console.log(`  skipped (tags matched no category): ${skippedNoCategory}`);
  console.log(`  skipped (no usable geometry): ${skippedNoGeom}`);
  console.log(`  skipped (unparseable id): ${skippedBadId}`);
  console.log(`  by category: ${JSON.stringify(counts)}`);
}

async function main() {
  console.log(`Connecting to ${DATABASE_URL} ...`);
  await importStatesAndDistricts();
  console.log(`\nImporting offices from ${GEOJSONSEQ_PATH} ...`);
  await importOffices();

  console.log("\nVerification:");
  const catCounts =
    await sql`SELECT category, count(*) FROM offices GROUP BY 1 ORDER BY 2 DESC`;
  console.table(catCounts);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
