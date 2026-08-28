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

## Government-dataset import (steps 5-6)

OSM covers a tiny fraction of India's government offices — verified counts
from this pipeline's own extract vs. reality: post offices 5,385 in OSM vs.
~155,000 real (~3%); police 4,536 vs. ~17,500; courts 799 vs. ~3,500; RTOs
164 vs. ~1,400. Steps 5 and 6 close that gap by importing authoritative
government datasets alongside OSM, instead of relying on OSM alone.

### ⚠️ Importing rows does NOT put them on the map

`/api/offices?bbox=` (the live API route) only ever returns `source='user'`
rows. **Every other pin on the map — including everything steps 5/6 import —
is drawn from the static `web/public/tiles/offices.pmtiles` file**, built by
`04-tiles.sh` from a GeoJSON export of the `offices` table at build time.
Running `npm run sources` / `npm run merge` only changes rows in Postgres.
**To make imported offices actually visible, you must re-run `npm run
tiles` (04-tiles.sh) afterwards and redeploy `offices.pmtiles`.** This is
easy to forget and produces a confusing "I imported 50k offices but the map
looks the same" result — don't skip it.

### Step 5 — `pipeline/05-sources/*.mjs`

One module per upstream dataset, all exporting the same interface:

```js
export const source = "indiapost";      // matches offices.source
export async function fetchRaw(ctx)      // -> raw rows, cached to data/raw/<source>.json
export function normalize(rows)          // -> CanonicalOffice[]
```

| module | status | endpoint |
|---|---|---|
| `indiapost.mjs` | **working**, no key needed | `https://api.postalpincode.in/pincode/<pincode>` — confirmed live. Returns **no lat/lng**, so every row is `location_precision: 'approximate'` until resolved against a pincode centroid (step 6). Also has an unverified `DATA_GOV_IN_API_KEY`-gated data.gov.in path (resource id scraped from the live catalog page but never confirmed against a real key — see the file's header comment); the postalpincode.in path is used regardless of whether the key is set. |
| `uidai.mjs` | **stubbed** | No open, scriptable dataset of Aadhaar enrolment-*center locations* (address/coordinates) was found — data.gov.in's Aadhaar datasets are aggregate enrolment statistics by pincode/age-group, a different shape of data. `fetchRaw()` logs why and returns `[]`; `normalize()` is fully implemented and unit-tested against a fixture. |
| `parivahan.mjs` | **stubbed** | parivahan.gov.in / Vahan / Sarathi are interactive portals; no documented RTO/DTO office-directory API or dataset was found. Same treatment as `uidai.mjs`. |
| `ecourts.mjs` | **stubbed** | services.ecourts.gov.in backs its own state → district → court-complex picker with an undocumented internal API; only paid third-party wrappers were found, not treated as authoritative. Same treatment as `uidai.mjs`. |

`DATA_GOV_IN_API_KEY` — read from the environment by `indiapost.mjs` (and
checked, for logging purposes, by `uidai.mjs`). `api.data.gov.in` returns
HTTP 400 ("Authorization field missing") without one — confirmed via curl.
None of the four modules crash the pipeline when it's unset; they log
clearly and continue.

`data/pincodes.json` — `indiapost.mjs` needs a master list of India's
~19,300 pincodes to enumerate via api.postalpincode.in (that API can only
look pincodes *up*, not list them). No scriptable, unauthenticated source
for the full list was found either. Drop a JSON array of 6-digit pincode
strings at `pipeline/data/pincodes.json` to fetch the real thing; absent
that file, `fetchRaw()` logs a warning and falls back to a 10-pincode seed
list so the client can still be exercised end-to-end.

Run:

```
node 05-sources/indiapost.mjs --smoke-test   # 3 live pincode lookups, prints normalized rows
npm run sources                              # runs fetchRaw+normalize for all four, writes
                                              # data/raw/<source>.canonical.json
```

Every module caches its raw fetch to `pipeline/data/raw/<source>.json`
(gitignored, same as the rest of `data/`) and resumes from that cache on
the next run — safe to interrupt.

### Step 6 — `06-merge.mjs`

Loads all four source modules, normalizes their rows, dedups against the
`offices` table (mostly OSM today) **and against each other**, then upserts
idempotently on `(source, source_ref)` and writes `office_services` rows.

**Dedup policy** (implemented in `pipeline/lib/canonical.mjs`, unit-tested
in `canonical.test.mjs`):

- **Tier A — geometric** (`isProbableDuplicate`): same `category`, AND
  normalized names equal or one contains the other, AND either both
  offices have coordinates within 500m, or neither has coordinates and
  they share a pincode/district. Since `offices.geom` is `NOT NULL`, every
  row already in the table always has real coordinates, so this is the
  primary check once an incoming row's own coordinates are resolved.
- **Tier B — text fallback** (`06-merge.mjs` only, not part of
  `canonical.mjs`'s tested API): used when a row's coordinates are only a
  pincode centroid (`location_precision: 'approximate'`) — a 500m radius
  against an area centroid is unreliable in both directions. Matches on
  normalized name (equal/containment) plus the incoming row's district
  appearing in the candidate's free-text address (`offices.district_id` is
  NULL for v1 OSM rows, so there's no structured join to use instead). A
  row counts as a duplicate if **either** tier fires — a missed genuinely-new
  office is a far better failure mode here than a doubled pin.
- **`chooseWinner`**: on a match, the existing row's geometry is kept
  (OSM/whatever's already there is `'exact'`; the incoming government row
  is usually `'approximate'`), its name/services are overwritten with the
  government row's (authoritative), and services are unioned. No new
  `offices` row is inserted for a match — only a genuinely new office gets
  one.
- Re-running `06-merge.mjs` for the same source is idempotent via the
  `offices_source_ref_key` partial unique index on `(source, source_ref)
  WHERE source_ref IS NOT NULL`.

**Pincode-centroid fallback**: rows with no coordinates (currently: every
`indiapost` row) are resolved against `pipeline/data/pincode-centroids.csv`
— a GeoNames-derived (CC BY 4.0) India postal-code centroid table,
auto-downloaded on first run from
`https://raw.githubusercontent.com/sanand0/pincode/master/data/IN.csv` and
cached locally (~11,000 of India's ~19,300 pincodes — not exhaustive). A
row whose pincode isn't in the table is **left un-inserted**; the count is
logged at the end of the run rather than guessing a coordinate.

Run:

```
npm run merge   # node 06-merge.mjs
```

Batched inserts (500/batch), `postgres` + `uuid`'s `v7()` ids, progress
logged every 5,000 rows processed per source — same conventions as
`03-import.mjs`. Verified against a live-but-rolled-back transaction
against the real `offices`/`office_services` schema while writing this
(the exact `INSERT ... ON CONFLICT` shapes work); the dedup index/lookup
logic (`createIndex`/`addToIndex`/`findDuplicate`, all pure and exported
from `06-merge.mjs`) was exercised directly against synthetic OSM + gov
rows covering both tiers. It was **not** run end-to-end against the real
~19,300-pincode India Post enumeration in this environment (no master
pincode list, see above) — only the 3-pincode smoke test.
