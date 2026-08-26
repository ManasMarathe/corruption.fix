#!/usr/bin/env bash
# Step 4: build web/public/tiles/offices.pmtiles from the extracted GeoJSON.
# This is the ONE file this pipeline writes under web/ — everything else
# stays inside pipeline/.
set -euo pipefail
cd "$(dirname "$0")"

command -v tippecanoe >/dev/null 2>&1 || {
  echo "tippecanoe not found. Install with: brew install tippecanoe" >&2
  exit 1
}

IN="data/india-offices.geojsonseq"
PREPARED="data/india-offices.tiles.geojsonseq"
OUT_DIR="../web/public/tiles"
OUT="$OUT_DIR/offices.pmtiles"

[ -f "$IN" ] || { echo "$IN missing — run 02-extract.sh first" >&2; exit 1; }

echo "== preparing tile GeoJSON (osm_uid, name, category only) =="
node lib/prepare-tiles-geojson.mjs

mkdir -p "$OUT_DIR"

echo
echo "== tippecanoe =="
tippecanoe \
  --force \
  -o "$OUT" \
  -l offices \
  -zg \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  -y osm_uid -y name -y category \
  "$PREPARED"

echo
echo "Tiles step complete: $OUT"
ls -la "$OUT_DIR"
