#!/usr/bin/env node
// Reads data/india-offices.geojsonseq (raw osmium export) and writes
// data/india-offices.tiles.geojsonseq: one clean GeoJSON Point Feature per
// line, properties trimmed to what the web map needs —
// osm_uid/name/category/services/precision/has_reports — with osm_uid
// computed via the exact same convention as 03-import.mjs (lib/osmuid.mjs)
// and the same category/name mapping (lib/office-tags.mjs), so a clicked
// tile feature's osm_uid always joins to the matching offices.osm_id row.
//
// `services`/`precision`/`has_reports` don't exist on the raw OSM tags —
// `location_precision` is always "exact" for OSM-sourced rows (only
// pincode-centroid bulk imports are "approximate"), and services/complaint
// stats only exist once an office has been imported and enriched in
// Postgres. So this script makes a second pass: after mapping every feature
// from tags, it looks up all of them in one batched query (not per-feature —
// that would be N round trips at 25k-180k features) and merges the result
// in before writing.
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { osmUid } from "./osmuid.mjs";
import {
  extractIdType,
  categoryFor,
  nameFor,
  hasName,
  centroidOfGeometry,
} from "./office-tags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const IN_PATH = join(DATA_DIR, "india-offices.geojsonseq");
const OUT_PATH = join(DATA_DIR, "india-offices.tiles.geojsonseq");

// Same DATABASE_URL convention as 03-import.mjs.
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost:5432/corruptionfix";

async function main() {
  const rl = createInterface({
    input: createReadStream(IN_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let processed = 0;
  // Buffered rather than streamed straight to `out` because the DB lookup
  // below needs every feature's osm_uid up front to run as a single batched
  // query. At current (tens of thousands) and projected (~180k) feature
  // counts this comfortably fits in memory.
  const pending = [];

  for await (const rawLine of rl) {
    const line = rawLine.charCodeAt(0) === 0x1e ? rawLine.slice(1) : rawLine;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let feature;
    try {
      feature = JSON.parse(trimmed);
    } catch {
      continue;
    }
    processed++;

    const tags = feature.properties || {};
    const category = categoryFor(tags);
    if (!category) continue;
    const point = centroidOfGeometry(feature.geometry);
    const idType = extractIdType(feature);
    if (!point || !idType) continue;

    const outFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        osm_uid: osmUid(idType.type, idType.id),
        name: nameFor(tags, category),
        category,
      },
    };
    // Tippecanoe GeoJSON extension: a feature with an explicit minzoom is
    // preserved down to that zoom even when --drop-densest-as-needed would
    // otherwise have thinned it out. Stamping this onto every NAMED feature
    // (89.5% of the extract) means dot-dropping in 04-tiles.sh has nothing
    // to work with except the unnamed 10.5%, so those are what gets
    // dropped first when a tile is over budget — see 04-tiles.sh.
    if (hasName(tags)) {
      outFeature.tippecanoe = { minzoom: 0 };
    }
    pending.push(outFeature);
  }

  console.log(
    `prepare-tiles-geojson: looking up ${pending.length} offices in Postgres for services/precision/has_reports ...`
  );
  const sql = postgres(DATABASE_URL, { max: 5 });
  let dbRows = [];
  try {
    const osmIds = pending.map((f) => f.properties.osm_uid);
    if (osmIds.length > 0) {
      // Correlated aggregates (not a plain JOIN) so the office_services
      // fan-out collapses back to one row per office. `has_reports` reads
      // office_stats.published_count — the same materialized view the web
      // app's office pages read (see drizzle/0001_office_stats_matview.sql)
      // — rather than aggregating `complaints` directly here.
      dbRows = await sql`
        SELECT
          o.osm_id,
          o.location_precision,
          coalesce(
            array_agg(os.service) FILTER (WHERE os.service IS NOT NULL),
            '{}'
          ) AS services,
          coalesce(max(stats.published_count), 0) > 0 AS has_reports
        FROM offices o
        LEFT JOIN office_services os ON os.office_id = o.id
        LEFT JOIN office_stats stats ON stats.office_id = o.id
        WHERE o.osm_id = ANY(${osmIds})
        GROUP BY o.osm_id, o.location_precision
      `;
    }
  } finally {
    await sql.end();
  }
  const byOsmId = new Map(dbRows.map((row) => [Number(row.osm_id), row]));

  const out = createWriteStream(OUT_PATH);
  let written = 0;
  for (const feature of pending) {
    const dbRow = byOsmId.get(feature.properties.osm_uid);
    if (dbRow) {
      if (dbRow.services && dbRow.services.length > 0) {
        feature.properties.services = dbRow.services.join(",");
      }
      // Omit `precision` entirely when exact (the default/common case) —
      // the client treats a missing property as exact, so this keeps most
      // features' tile properties one field shorter.
      if (dbRow.location_precision === "approximate") {
        feature.properties.precision = "approximate";
      }
      if (dbRow.has_reports) {
        feature.properties.has_reports = 1;
      }
    }
    out.write(JSON.stringify(feature) + "\n");
    written++;
  }

  await new Promise((resolve) => out.end(resolve));
  console.log(
    `prepare-tiles-geojson: read ${processed} features, wrote ${written} -> ${OUT_PATH}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
