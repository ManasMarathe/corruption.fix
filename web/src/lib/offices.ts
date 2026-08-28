import { cache } from "react";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  complaints,
  officeViewCounts,
  officers,
  offices,
  type OfficeCategory,
} from "@/db/schema";
import { newId } from "./uuid";

/**
 * Data-access helpers for offices, kept out of route handlers (same
 * convention as otp.ts/vault.ts) so the routes stay thin and this logic is
 * reusable between the map API routes and the office detail page.
 *
 * Reads select `lng`/`lat` via `ST_X`/`ST_Y` rather than the raw `geom`
 * column — see the comment on `geometryPoint` in src/db/geometry.ts: the
 * driver returns geometry columns as raw EWKB unless explicitly unwrapped,
 * so plain `offices.geom` selects would not round-trip through
 * `fromDriver`'s WKT parser.
 */

export interface OfficePoint {
  id: string;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
  address: string | null;
}

const OFFICE_POINT_COLUMNS = {
  id: offices.id,
  name: offices.name,
  category: offices.category,
  address: offices.address,
  lng: sql<number>`ST_X(${offices.geom})`,
  lat: sql<number>`ST_Y(${offices.geom})`,
};

export async function searchOffices(
  query: string,
  limit: number
): Promise<OfficePoint[]> {
  const rows = await db
    .select(OFFICE_POINT_COLUMNS)
    .from(offices)
    .where(ilike(offices.name, `%${query}%`))
    .limit(limit);
  return rows as OfficePoint[];
}

export async function lookupOfficeByOsmUid(
  osmUid: number
): Promise<OfficePoint | null> {
  const rows = await db
    .select(OFFICE_POINT_COLUMNS)
    .from(offices)
    .where(eq(offices.osmId, osmUid))
    .limit(1);
  return (rows[0] as OfficePoint | undefined) ?? null;
}

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** User-added (`source = 'user'`) offices intersecting `bbox`, capped at `limit`. */
export async function userOfficesInBbox(
  bbox: Bbox,
  limit: number
): Promise<OfficePoint[]> {
  const rows = await db
    .select(OFFICE_POINT_COLUMNS)
    .from(offices)
    .where(
      and(
        eq(offices.source, "user"),
        sql`ST_MakeEnvelope(${bbox.minLng}, ${bbox.minLat}, ${bbox.maxLng}, ${bbox.maxLat}, 4326) && ${offices.geom}`
      )
    )
    .limit(limit);
  return rows as OfficePoint[];
}

export interface NewUserOffice {
  name: string;
  category: OfficeCategory;
  lat: number;
  lng: number;
  address?: string | null;
}

export async function insertUserOffice(
  input: NewUserOffice
): Promise<OfficePoint & { status: string }> {
  const id = newId();
  await db.insert(offices).values({
    id,
    name: input.name,
    category: input.category,
    geom: { lng: input.lng, lat: input.lat },
    address: input.address ?? null,
    source: "user",
    status: "user_added",
  });
  return {
    id,
    name: input.name,
    category: input.category,
    lng: input.lng,
    lat: input.lat,
    address: input.address ?? null,
    status: "user_added",
  };
}

// The office-page readers below are wrapped in React cache() so a single
// request that needs the same row twice (generateMetadata + the page
// component both call getOfficeById) issues one query. Next only dedupes
// fetch(), not driver calls.
export const getOfficeById = cache(async function getOfficeById(
  id: string
): Promise<(OfficePoint & { status: string; source: string }) | null> {
  const rows = await db
    .select({
      ...OFFICE_POINT_COLUMNS,
      status: offices.status,
      source: offices.source,
    })
    .from(offices)
    .where(eq(offices.id, id))
    .limit(1);
  return (rows[0] as (OfficePoint & { status: string; source: string }) | undefined) ?? null;
});

export interface OfficeStats {
  officeId: string;
  complaintCount: number;
  publishedCount: number;
  topService: string | null;
  medianBribe: number | null;
  lastMonth: string | null;
}

type OfficeStatsRow = {
  office_id: string;
  complaint_count: number;
  published_count: number;
  top_service: string | null;
  median_bribe: string | number | null;
  last_month: string | null;
};

/**
 * Reads the `office_stats` materialized view — the only place office
 * complaint aggregates should ever come from (see the comment atop
 * drizzle/0001_office_stats_matview.sql). Never aggregate `complaints`
 * per-request.
 */
export const getOfficeStats = cache(async function getOfficeStats(
  id: string
): Promise<OfficeStats | null> {
  const rows = await db.execute<OfficeStatsRow>(sql`
    SELECT office_id, complaint_count, published_count, top_service, median_bribe, last_month
    FROM office_stats
    WHERE office_id = ${id}
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    officeId: row.office_id,
    complaintCount: row.complaint_count,
    publishedCount: row.published_count,
    topService: row.top_service,
    medianBribe: row.median_bribe === null ? null : Number(row.median_bribe),
    lastMonth: row.last_month,
  };
});

export interface PublishedOfficer {
  id: string;
  name: string;
  designation: string | null;
  replyText: string | null;
}

/**
 * Officers published for this office. Deliberately omits a per-officer
 * complaint count — matching it back to complaints requires normalizing
 * `officer_name_private` against `officers.name_normalized`, which is
 * exactly the kind of coupling the private/public split exists to avoid.
 */
export const getPublishedOfficers = cache(async function getPublishedOfficers(
  officeId: string
): Promise<PublishedOfficer[]> {
  const rows = await db
    .select({
      id: officers.id,
      name: officers.nameNormalized,
      designation: officers.designation,
      replyText: officers.replyText,
    })
    .from(officers)
    .where(and(eq(officers.officeId, officeId), eq(officers.status, "published")));
  return rows;
});

export interface PublishedComplaint {
  id: string;
  publicMonth: string | null;
  serviceType: string;
  bribeAmount: number | null;
  narrative: string;
}

/**
 * Published complaints for public display. Only ever selects the columns
 * that are safe to show publicly — never `reporter_id`, exact
 * `created_at`, or `officer_name_private`.
 */
export const getPublishedComplaints = cache(async function getPublishedComplaints(
  officeId: string
): Promise<PublishedComplaint[]> {
  const rows = await db
    .select({
      id: complaints.id,
      publicMonth: complaints.publicMonth,
      serviceType: complaints.serviceType,
      bribeAmount: complaints.bribeAmount,
      narrative: complaints.narrative,
    })
    .from(complaints)
    .where(and(eq(complaints.officeId, officeId), eq(complaints.status, "published")))
    .orderBy(desc(complaints.publicMonth));
  return rows;
});

/** Today's date at UTC midnight, as a plain calendar day for `office_view_counts.day`. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Increments today's view count for `officeId`. Fire-and-forget by design —
 * callers should log and swallow errors rather than fail the request (a
 * bad/missing office id raises a foreign key violation here, which is
 * expected for spammed/garbage ids and not worth surfacing to the client).
 */
export async function bumpOfficeView(officeId: string): Promise<void> {
  const day = todayUtc();
  await db
    .insert(officeViewCounts)
    .values({ officeId, day, views: 1 })
    .onConflictDoUpdate({
      target: [officeViewCounts.officeId, officeViewCounts.day],
      set: { views: sql`${officeViewCounts.views} + 1` },
    });
}
