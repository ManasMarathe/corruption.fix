#!/usr/bin/env bash
# Step 2: filter the India PBF down to the tags we care about, then export
# to newline-delimited GeoJSON (GeoJSONSeq) for streaming import.
set -euo pipefail
cd "$(dirname "$0")"

command -v osmium >/dev/null 2>&1 || {
  echo "osmium not found. Install with: brew install osmium-tool" >&2
  exit 1
}

IN="data/india-latest.osm.pbf"
FILTERED="data/india-offices.osm.pbf"
OUT="data/india-offices.geojsonseq"

[ -f "$IN" ] || { echo "$IN missing — run 01-download.sh first" >&2; exit 1; }

echo "== osmium tags-filter =="
echo "  amenity=police, amenity=post_office, amenity=courthouse, office=government"
osmium tags-filter \
  --overwrite \
  -o "$FILTERED" \
  "$IN" \
  nwr/amenity=police \
  nwr/amenity=post_office \
  nwr/amenity=courthouse \
  nwr/office=government
echo "  done: $(ls -la "$FILTERED")"

echo
echo "== osmium export -> GeoJSONSeq =="
# -a type,id: adds "@type"/"@id" attributes to each feature's properties so
#   03-import.mjs / lib/osmuid.mjs can compute a stable global id.
# --geometry-types=point,polygon: nodes come through as Point; way/relation
#   buildings come through as Polygon (import script takes the centroid).
osmium export \
  --overwrite \
  -f geojsonseq \
  -a type,id \
  --geometry-types=point,polygon \
  -o "$OUT" \
  "$FILTERED"
echo "  done: $(ls -la "$OUT")"
echo "  feature count: $(wc -l < "$OUT")"

echo
echo "Extract step complete: $OUT"
