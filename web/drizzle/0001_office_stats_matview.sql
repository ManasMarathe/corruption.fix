-- office_stats: precomputed per-office complaint aggregates.
--
-- This is the ONLY thing the public office pages read for stats — never
-- per-request aggregates over `complaints`. Refreshed by the
-- `refresh-stats` job (`/api/jobs/refresh-stats`) via
-- REFRESH MATERIALIZED VIEW CONCURRENTLY (hence the unique index).
--
-- Counting rule: `pending` complaints count toward totals immediately
-- (a filed complaint is a fact even before moderation); only `published`
-- ones have public narratives. `rejected`/`tombstoned` count nowhere.
CREATE MATERIALIZED VIEW office_stats AS
SELECT
  o.id AS office_id,
  count(c.id)::int AS complaint_count,
  count(c.id) FILTER (WHERE c.status = 'published')::int AS published_count,
  mode() WITHIN GROUP (ORDER BY c.service_type) AS top_service,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY c.bribe_amount)
    FILTER (WHERE c.bribe_amount IS NOT NULL) AS median_bribe,
  max(c.public_month) AS last_month
FROM offices o
LEFT JOIN complaints c
  ON c.office_id = o.id
  AND c.status IN ('pending', 'published')
GROUP BY o.id;
--> statement-breakpoint
CREATE UNIQUE INDEX office_stats_office_id_key ON office_stats (office_id);
