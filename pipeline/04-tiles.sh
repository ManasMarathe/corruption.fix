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

echo "== preparing tile GeoJSON (osm_uid, name, category, services, precision, has_reports) =="
node lib/prepare-tiles-geojson.mjs

mkdir -p "$OUT_DIR"

echo
echo "== tippecanoe =="
# -z13 (--maximum-zoom): explicit instead of -zg. -zg guessed maxzoom 10
#   from feature spacing across the whole country, which is far too coarse
#   once dense cities are in the mix — z12-13 is roughly the zoom range
#   where individual buildings/blocks are distinguishable. (If dense areas
#   still look thin, raise this further; --extend-zooms-if-still-dropping
#   below is a backstop, not a substitute for picking the right number.)
# --extend-zooms-if-still-dropping: if a tile is still over the 500K size
#   limit even at z13, keep adding zoom levels rather than dropping more —
#   safety net past the explicit maxzoom above.
# --drop-densest-as-needed: when a tile is still too big, thin it by
#   increasing the minimum spacing between features. Only features WITHOUT
#   an explicit "tippecanoe":{"minzoom":...} are eligible to be thinned this
#   way — lib/prepare-tiles-geojson.mjs stamps minzoom:0 onto every NAMED
#   feature (89.5% of the extract), so this flag's dropping falls on the
#   unnamed 10.5% first instead of at random. This is deliberate thinning,
#   not the previous behavior where -zg's guessed maxzoom silently dropped
#   ~25k features at every zoom 0-9 with no way to tell what was lost.
# -y ...: allowlist exactly the properties the map/filter panel reads
#   (see web/src/lib/offices.ts and the map filter panel) — keeps tiles
#   smaller than osmium's full OSM tag set would.
tippecanoe \
  --force \
  -o "$OUT" \
  -l offices \
  -z13 \
  --extend-zooms-if-still-dropping \
  --drop-densest-as-needed \
  -y osm_uid -y name -y category -y services -y precision -y has_reports \
  "$PREPARED"

echo
echo "Tiles step complete: $OUT"
ls -la "$OUT_DIR"
