#!/usr/bin/env bash
# Step 1: download raw inputs into pipeline/data/
#   - India OSM extract (Geofabrik), ~1.4GB, resumable
#   - LGD states/districts reference data (see caveats below and in README)
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p data

PBF_URL="https://download.geofabrik.de/asia/india-latest.osm.pbf"
PBF_OUT="data/india-latest.osm.pbf"

echo "== OSM PBF =="
if [ -f "$PBF_OUT" ]; then
  echo "  $PBF_OUT already exists, resuming/verifying with curl -C -"
else
  echo "  downloading $PBF_URL -> $PBF_OUT (~1.4GB, resumable)"
fi
curl -L -C - --fail --retry 5 --retry-delay 10 -o "$PBF_OUT" "$PBF_URL"
echo "  done: $(ls -la "$PBF_OUT")"

echo
echo "== LGD states/districts =="
# lgdirectory.gov.in has no stable scriptable export endpoint (interactive
# session required). We tried a couple of commonly-cited mirrors below; if
# none resolve to real LGD-coded CSV/JSON, fall back to the embedded
# best-effort dataset in generate-lgd-data.mjs (see README "LGD data
# caveats" for details on why and what "best-effort" means here).
CANDIDATE_URLS=(
  "https://raw.githubusercontent.com/datameet/maps/master/State/India_State_Boundary.geojson"
)
FETCHED_LIVE=0
for url in "${CANDIDATE_URLS[@]}"; do
  echo "  probing $url"
  if curl -sfL --max-time 20 -o /tmp/lgd-probe.json "$url"; then
    if grep -qi "lgd" /tmp/lgd-probe.json 2>/dev/null; then
      echo "  looks LGD-coded, but no automated ingester wired up for this source yet — skipping"
    fi
  fi
done

if [ "$FETCHED_LIVE" -eq 0 ]; then
  echo "  no reliable live LGD source found -> generating best-effort data/states.json + data/districts.csv"
  node data/generate-lgd-data.mjs
fi

echo
echo "Download step complete."
