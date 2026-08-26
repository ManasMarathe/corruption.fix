# CorruptionFix seed-data pipeline

Turns the Geofabrik India OSM extract into rows in `offices` (+ `states` /
`districts`) and a `web/public/tiles/offices.pmtiles` vector tile file for
the map UI.

This directory is self-contained (`pipeline/package.json`, own `node_modules`)
and does not touch `web/` except for one write: `web/public/tiles/offices.pmtiles`.

## Prerequisites

```
brew install osmium-tool tippecanoe   # OSM filtering/export + tile builder
# Postgres 16 + PostGIS, with DATABASE_URL from web/.env.local reachable,
# and the `offices` table migrated — both handled outside this pipeline.
cd pipeline && npm install
```

## Steps

Run individually or all at once with `npm run all`.

| step | script | what it does | expected time / size |
|---|---|---|---|
| 1 | `npm run download` (`01-download.sh`) | Downloads `data/india-latest.osm.pbf` from Geofabrik (resumable via `curl -C -`); generates `data/states.json` + `data/districts.csv` (see caveats below) | ~1.4GB, minutes-to-tens-of-minutes depending on bandwidth |
| 2 | `npm run extract` (`02-extract.sh`) | `osmium tags-filter` down to `amenity=police\|post_office\|courthouse`, `office=government`, then `osmium export` to `data/india-offices.geojsonseq` (point + polygon geometries, `@type`/`@id` attributes attached) | a minute or two |
| 3 | `npm run import` (`03-import.mjs`) | Streams `states.json`/`districts.csv` then `india-offices.geojsonseq` into Postgres, upserting on `lgd_code` / `osm_id` | a few minutes; batches of 500, progress logged every 10k features |
| 4 | `npm run tiles` (`04-tiles.sh`) | Runs `lib/prepare-tiles-geojson.mjs` (same tag-mapping as step 3, trimmed to `osm_uid`/`name`/`category`) then `tippecanoe` → `web/public/tiles/offices.pmtiles` | a minute or two; expect ~10-40MB output |

`npm run all` chains all four.

## The `osm_uid` convention

Raw OSM ids are only unique **within** an element type — a `node` and a
`way` can share the same numeric id. Both the DB import (`offices.osm_id`)
and the tile build (`osm_uid` tile property) need one globally-unique id so
a clicked map feature can be joined straight back to its `offices` row.
That id is computed once, in `pipeline/lib/osmuid.mjs`, and imported by
both `03-import.mjs` and `lib/prepare-tiles-geojson.mjs`:

```
node:     id
way:      id + 10_000_000_000   (1e10)
relation: id + 20_000_000_000   (2e10)
```

This fits comfortably in a Postgres `bigint` and in a JS safe integer
(`< 2^53`). If the web app ever needs to go the other direction (uid ->
OSM type/id), it can invert this by comparing against the two offset
thresholds.

`lib/office-tags.mjs` similarly centralizes the OSM-tags -> category/name/
address/centroid mapping so the DB rows and the tile properties can never
drift apart on category or display name.

## Category mapping

- `amenity=police` -> `police`
- `amenity=post_office` -> `post_office`
- `amenity=courthouse` -> `court`
- `office=government` -> `govt_office`, unless the name matches
  `/RTO|Regional Transport/i`, in which case -> `rto`

`name`: `tags.name`, falling back to `tags["name:en"]`, falling back to
`"<Category label> (unnamed)"`. `address`: `addr:*` tags joined with `, `.
Non-point geometries (way/relation building footprints) are reduced to an
area-weighted centroid of their outer ring(s).

## LGD data caveats

`lgdirectory.gov.in` (the canonical Local Government Directory) has no
stable, scriptable export URL — it's an interactive portal. `01-download.sh`
probes one commonly-cited open mirror and falls back to generating the data
locally via `data/generate-lgd-data.mjs` when nothing usable is found
(which, as of this pipeline's authoring, is always — the fallback is what
actually runs today).

- **`data/states.json`** (36 states/UTs): `lgd_code` values here are the
  standard, well-documented LGD/Census state codes. These are stable and
  should be treated as reliable.
- **`data/districts.csv`** (~768 districts, columns `lgd_code,
  state_lgd_code, name`): district *names* are from general knowledge, not
  scraped from LGD, and the `lgd_code` values are **synthetic sequential
  ids (100000+)**, NOT real LGD district codes — they exist only to give
  each district a stable unique key for the `districts` table's
  `lgd_code UNIQUE NOT NULL` constraint. District boundaries/counts change
  often (states routinely carve out new districts), so treat this file as
  best-effort and refreshable, not authoritative.

To refresh with real data later: manually export a CSV from
lgdirectory.gov.in and regenerate `states.json`/`districts.csv` in the same
shape (or replace `generate-lgd-data.mjs`'s embedded tables).

**`offices.district_id` is left `NULL` by `03-import.mjs` for v1.** Doing a
real point-in-polygon assignment needs district *boundary geometries*,
which this pipeline doesn't fetch (districts.csv has no geometry column).
`offices.district_id` is nullable in the schema specifically so this is
safe to defer — offices only *optionally* link to a district.

## Verifying an import

```sql
SELECT category, count(*) FROM offices GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FROM states;
SELECT count(*) FROM districts;
```

Rough expectations for the India extract: tens of thousands of offices
total, police ~15-30k, post offices ~20-60k (Indian Post has an unusually
dense network so this is often the largest category), courts and
government offices generally lower (OSM coverage for `office=government`
and `amenity=courthouse` in India is patchier than police/post office
tagging).

## Re-running

Every step is idempotent:
- `01-download.sh` skips the PBF if already present (resumes via `-C -`
  otherwise) and regenerates the LGD files each time.
- `03-import.mjs` upserts on `lgd_code` (states/districts) and `osm_id`
  (offices) — safe to re-run after a fresh extract.
- `04-tiles.sh` overwrites `offices.pmtiles` in place (`tippecanoe --force`).
