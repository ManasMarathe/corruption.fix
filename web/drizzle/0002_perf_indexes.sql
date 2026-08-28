-- Performance indexes for the two hot map queries (see src/lib/offices.ts).
--
-- 1. `userOfficesInBbox` filters `source = 'user' AND envelope && geom`.
--    The full offices_geom_gix matches essentially every OSM row at wide
--    zooms, and with no index on `source` Postgres filter-scans them all
--    looking for the rare user-added rows. A partial GiST index over just
--    `source = 'user'` makes the query proportional to user-added offices,
--    not the whole OSM extract. offices_geom_gix stays for any future
--    all-source spatial query.
--
-- 2. `searchOffices` runs `name ILIKE '%q%'` — a leading wildcard no btree
--    can serve. pg_trgm's GIN index makes it an index scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offices_user_geom_gix" ON "offices" USING gist ("geom") WHERE "source" = 'user';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offices_name_trgm_idx" ON "offices" USING gin ("name" gin_trgm_ops);
