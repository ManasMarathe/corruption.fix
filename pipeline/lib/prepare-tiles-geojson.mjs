#!/usr/bin/env node
// Reads data/india-offices.geojsonseq (raw osmium export) and writes
// data/india-offices.tiles.geojsonseq: one clean GeoJSON Point Feature per
// line, properties trimmed to what the web map needs — osm_uid, name,
// category — with osm_uid computed via the exact same convention as
// 03-import.mjs (lib/osmuid.mjs) and the same category/name mapping
// (lib/office-tags.mjs), so a clicked tile feature's osm_uid always joins
// to the matching offices.osm_id row.
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { osmUid } from "./osmuid.mjs";
import {
  extractIdType,
  categoryFor,
  nameFor,
  centroidOfGeometry,
} from "./office-tags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const IN_PATH = join(DATA_DIR, "india-offices.geojsonseq");
const OUT_PATH = join(DATA_DIR, "india-offices.tiles.geojsonseq");

async function main() {
  const rl = createInterface({
    input: createReadStream(IN_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const out = createWriteStream(OUT_PATH);

  let processed = 0;
  let written = 0;

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
    out.write(JSON.stringify(outFeature) + "\n");
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
