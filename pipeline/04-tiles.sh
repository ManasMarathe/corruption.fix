#!/usr/bin/env bash
# Step 4: build web/public/tiles/offices.pmtiles from the `offices` table.
# This is the ONE file this pipeline writes under web/ — everything else
# stays inside pipeline/.
#
# Note the input: lib/prepare-tiles-geojson.mjs reads Postgres, NOT
# data/india-offices.geojsonseq. That is what makes offices with no OSM
# presence (everything steps 5-6 import) reachable by the map — see the
# header comment in that script. So this step needs a populated database
# (DATABASE_URL, same convention as 03-import.mjs), not an OSM extract on
# disk; run step 3 (and optionally 5-6) first.
set -euo pipefail
cd "$(dirname "$0")"

command -v tippecanoe >/dev/null 2>&1 || {
  echo "tippecanoe not found. Install with: brew install tippecanoe" >&2
  exit 1
}

PREPARED="data/india-offices.tiles.geojsonseq"
OUT_DIR="../web/public/tiles"
OUT="$OUT_DIR/offices.pmtiles"

echo "== preparing tile GeoJSON (id, osm_uid, name, category, services, precision, has_reports) =="
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
#   (see web/src/components/map/MapHome.tsx and MapFilterPanel.tsx) — keeps
#   tiles smaller than the full column set would. `id` is the office uuid,
#   which lets a clicked pin link straight to /office/<id> instead of
#   round-tripping through /api/offices/lookup?osm_uid=.
tippecanoe \
  --force \
  -o "$OUT" \
  -l offices \
  -z13 \
  --extend-zooms-if-still-dropping \
  --drop-densest-as-needed \
  -y id -y osm_uid -y name -y category -y services -y precision -y has_reports \
  "$PREPARED"

echo
echo "Tiles step complete: $OUT"
ls -la "$OUT_DIR"
