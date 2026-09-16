#!/usr/bin/env node
// Writes data/india-offices.tiles.geojsonseq: one clean GeoJSON Point
// Feature per line, ready for tippecanoe (see 04-tiles.sh).
//
// The source of truth is the `offices` TABLE, not the OSM extract.
//
// That distinction is the whole point of this script. It used to read
// data/india-offices.geojsonseq (osmium's export) and merely look each
// feature up in Postgres by osm_id to decorate it. That meant a row with no
// osm_id could never reach the tiles at all — and every row created by the
// government-dataset import (steps 5-6: India Post, UIDAI, Parivahan,
// eCourts) has osm_id NULL, keyed on (source, source_ref) instead. Since the
// map draws everything except user-added offices from these tiles, ~155k
// imported post offices were invisible no matter how many times anyone
// re-ran the pipeline, and `location_precision = 'approximate'` (which only
// those rows ever carry) had nothing to describe. Reading the table fixes
// that for every source at once, present and future.
//
// Properties written, all of them in 04-tiles.sh's `-y` allowlist:
//
//   osm_uid     OSM-sourced rows. offices.osm_id already holds the
//               lib/osmuid.mjs-encoded value (03-import.mjs writes it that
//               way), so it is copied straight across and the pin resolves
//               through /api/offices/lookup?osm_uid=.
//   id          offices.id (uuid), written ONLY for rows with no osm_id —
//               i.e. everything the government-dataset import creates, which
//               has no other way to be identified. See featureForRow for why
//               it is not written for every feature (it costs 9x in tile
//               size). The map reads `properties.id` first and falls back to
//               the osm_uid lookup.
//   name        offices.name as stored (nameFor() already applied at import).
//   category    offices.category.
//   services    comma-joined office_services rows; omitted when empty.
//   precision   "approximate" only; omitted when exact, since the web map
//               treats a missing property as exact.
//   has_reports 1 when office_stats.published_count > 0; omitted otherwise.
//
// `source = 'user'` rows are deliberately excluded: the live map already
// draws those from GET /api/offices?bbox= as their own GeoJSON layer, so
// baking them in too would double-draw every user contribution.
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { isFallbackName } from "./office-tags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const OUT_PATH = join(DATA_DIR, "india-offices.tiles.geojsonseq");

// Same DATABASE_URL convention as 03-import.mjs.
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost:5432/corruptionfix";

// Rows pulled per cursor fetch. Streamed rather than buffered: the table is
// ~180k rows today and only grows, and nothing here needs more than one row
// at a time.
const CURSOR_SIZE = 2_000;

const PROGRESS_EVERY = 25_000;

// Number(null) and Number("") are both 0, which would silently place an
// office off the coast of Africa rather than being rejected — so null-ish
// values are turned into NaN before the finite check, not coerced.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

/** Turns one `offices` row into the tile Feature for it, or null when the
 * row has no usable coordinates. */
export function featureForRow(row) {
  const lng = toFiniteNumber(row.lng);
  const lat = toFiniteNumber(row.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  const properties = {
    name: row.name,
    category: row.category,
  };

  // Exactly ONE identifier per feature, and osm_uid is preferred because it
  // is a number rather than a 36-character uuid.
  //
  // That sounds like a micro-optimisation and is not: every named feature
  // carries tippecanoe.minzoom 0 (see below), so it is replicated into all
  // 14 zoom levels, and a uuid is high-entropy enough that the string pool
  // cannot dedupe it. Emitting `id` for all ~25k OSM rows measured at 14.2MB
  // of tiles against 1.5MB for osm_uid alone — a 9x cost paid on every pan,
  // to save one hard-cached /api/offices/lookup call per pin click.
  //
  // Rows with no osm_id — everything the government-dataset import creates —
  // have nothing else to be found by, so those do carry the uuid. They are
  // the minority, and the map reads `properties.id` first either way.
  //
  // osm_id is int8; postgres.js hands int8 back as a string, hence Number().
  if (row.osm_id !== null && row.osm_id !== undefined) {
    properties.osm_uid = Number(row.osm_id);
  } else {
    properties.id = row.id;
  }
  if (Array.isArray(row.services) && row.services.length > 0) {
    properties.services = row.services.join(",");
  }
  if (row.location_precision === "approximate") {
    properties.precision = "approximate";
  }
  if (row.has_reports) {
    properties.has_reports = 1;
  }

  const feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };

  // Tippecanoe GeoJSON extension: a feature with an explicit minzoom is
  // preserved down to that zoom even when --drop-densest-as-needed would
  // otherwise have thinned it out. Stamping it onto every NAMED feature means
  // dot-dropping in 04-tiles.sh has nothing to work with except the unnamed
  // ones, so those are what gets dropped first when a tile is over budget.
  if (!isFallbackName(row.name)) {
    feature.tippecanoe = { minzoom: 0 };
  }

  return feature;
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1 });
  const out = createWriteStream(OUT_PATH);

  let written = 0;
  let skipped = 0;

  try {
    // Fail loudly and early rather than producing an empty tile set, which
    // looks exactly like a successful run until someone opens the map.
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM offices WHERE source <> 'user'
    `;
    if (count === 0) {
      throw new Error(
        "offices is empty (no non-user rows) — run 03-import.mjs (and, for " +
          "government datasets, 05-sources + 06-merge) before building tiles."
      );
    }
    console.log(`prepare-tiles-geojson: streaming ${count} offices from Postgres ...`);

    // Correlated aggregates via GROUP BY (not a plain JOIN) so the
    // office_services fan-out collapses back to one row per office.
    // `has_reports` reads office_stats.published_count — the same
    // materialized view the web app's office pages read (see
    // drizzle/0001_office_stats_matview.sql) — rather than aggregating
    // `complaints` directly here. A row missing from office_stats (added
    // since the last refresh-stats run) simply reads as "no reports".
    const cursor = sql`
      SELECT
        o.id,
        o.osm_id,
        o.name,
        o.category,
        ST_X(o.geom) AS lng,
        ST_Y(o.geom) AS lat,
        o.location_precision,
        coalesce(
          array_agg(os.service) FILTER (WHERE os.service IS NOT NULL),
          '{}'
        ) AS services,
        coalesce(max(stats.published_count), 0) > 0 AS has_reports
      FROM offices o
      LEFT JOIN office_services os ON os.office_id = o.id
      LEFT JOIN office_stats stats ON stats.office_id = o.id
      WHERE o.source <> 'user'
      -- Grouping by the primary key alone is enough: every other offices
      -- column is functionally dependent on it, which Postgres recognises.
      GROUP BY o.id
      ORDER BY o.id
    `.cursor(CURSOR_SIZE);

    for await (const rows of cursor) {
      for (const row of rows) {
        const feature = featureForRow(row);
        if (!feature) {
          skipped++;
          continue;
        }
        // Respect backpressure — at 180k lines the write buffer would
        // otherwise grow without bound while Postgres keeps feeding us.
        if (!out.write(JSON.stringify(feature) + "\n")) {
          await once(out, "drain");
        }
        written++;
        if (written % PROGRESS_EVERY === 0) {
          console.log(`prepare-tiles-geojson: ${written} features written ...`);
        }
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
    await sql.end();
  }

  console.log(
    `prepare-tiles-geojson: wrote ${written} features` +
      (skipped > 0 ? ` (skipped ${skipped} with unusable geometry)` : "") +
      ` -> ${OUT_PATH}`
  );
}

// Only connect when run as a script. featureForRow is exported for
// prepare-tiles-geojson.test.mjs, and importing a module must never open a
// database connection as a side effect.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
