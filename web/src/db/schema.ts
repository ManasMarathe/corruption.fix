import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { geometryPoint } from "./geometry";

// ---------------------------------------------------------------------------
// vault schema
//
// Reporter identity (email/phone) lives here, encrypted and HMAC-indexed,
// isolated from the `public` schema so that ordinary application code paths
// (and a compromised `public`-schema-only credential) never see plaintext
// contact info. `complaints.reporter_id` in the public schema deliberately
// has no foreign key into this schema.
// ---------------------------------------------------------------------------

// Named `identity_vault` (not `vault`) because Supabase reserves a `vault`
// schema for its own secrets extension (owned by supabase_admin, not
// writable by the app's role).
export const vault = pgSchema("identity_vault");

export const reporterIdentities = vault.table("reporter_identities", {
  id: uuid("id").primaryKey(),
  emailEnc: text("email_enc").notNull(),
  emailHmac: text("email_hmac").notNull().unique(),
  phoneEnc: text("phone_enc"),
  phoneHmac: text("phone_hmac").unique(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const vaultAccessLog = vault.table("vault_access_log", {
  id: uuid("id").primaryKey(),
  reporterId: uuid("reporter_id").notNull(),
  accessor: text("accessor").notNull(),
  purpose: text("purpose").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// public schema
// ---------------------------------------------------------------------------

export const states = pgTable("states", {
  id: uuid("id").primaryKey(),
  lgdCode: integer("lgd_code").notNull().unique(),
  name: text("name").notNull(),
});

export const districts = pgTable("districts", {
  id: uuid("id").primaryKey(),
  lgdCode: integer("lgd_code").notNull().unique(),
  name: text("name").notNull(),
  stateId: uuid("state_id")
    .notNull()
    .references(() => states.id),
});

export const OFFICE_CATEGORIES = [
  "police",
  "post_office",
  "court",
  "govt_office",
  "rto",
  "other",
] as const;
export type OfficeCategory = (typeof OFFICE_CATEGORIES)[number];

// "osm" and "user" are the original two. The rest are authoritative
// government datasets imported by pipeline/05-sources/* — OSM covers only a
// small fraction of India's offices (~3% of post offices), so bulk imports
// are the only way the map reflects reality. See pipeline/README.md.
export const OFFICE_SOURCES = [
  "osm",
  "user",
  "indiapost",
  "uidai",
  "parivahan",
  "ecourts",
  "police",
] as const;
export type OfficeSource = (typeof OFFICE_SOURCES)[number];

export const OFFICE_STATUSES = ["seeded", "user_added", "verified"] as const;
export type OfficeStatus = (typeof OFFICE_STATUSES)[number];

/**
 * How much to trust an office's coordinates.
 *
 * "exact" — from OSM, or a pin a human placed.
 * "approximate" — derived from a pincode centroid because the upstream
 *   dataset carries no coordinates. The India Post directory (~155k offices)
 *   is entirely in this category, so these are drawn differently and hidden
 *   by default; the /add-office pin flow is how they get corrected.
 */
export const LOCATION_PRECISIONS = ["exact", "approximate"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const offices = pgTable(
  "offices",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    // geometry(Point,4326); GiST index created via raw SQL in the migration
    // (see drizzle/*.sql) rather than through the schema builder. A partial
    // GiST index (WHERE source = 'user') and a pg_trgm GIN index on name
    // also live in drizzle/0002_perf_indexes.sql.
    geom: geometryPoint("geom").notNull(),
    address: text("address"),
    districtId: uuid("district_id").references(() => districts.id),
    source: text("source").notNull(),
    osmId: bigint("osm_id", { mode: "number" }).unique(),
    // Stable upstream identity within `source`, e.g. "400004:Ambewadi" for
    // India Post. The (source, source_ref) unique index is what makes
    // re-running an import idempotent instead of duplicating every office.
    sourceRef: text("source_ref"),
    locationPrecision: text("location_precision").notNull().default("exact"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("offices_district_id_idx").on(table.districtId),
    index("offices_category_idx").on(table.category),
    // Partial: every pre-existing OSM row has a NULL source_ref, and only
    // imported rows carry one. Postgres treats NULLs as distinct in a unique
    // index anyway, but saying so explicitly keeps the intent legible and
    // survives anyone reaching for NULLS NOT DISTINCT later.
    uniqueIndex("offices_source_ref_key")
      .on(table.source, table.sourceRef)
      .where(sql`${table.sourceRef} is not null`),
    check(
      "offices_category_check",
      sql`${table.category} in ('police','post_office','court','govt_office','rto','other')`
    ),
    check(
      "offices_source_check",
      sql`${table.source} in ('osm','user','indiapost','uidai','parivahan','ecourts','police')`
    ),
    check(
      "offices_location_precision_check",
      sql`${table.locationPrecision} in ('exact','approximate')`
    ),
    check(
      "offices_status_check",
      sql`${table.status} in ('seeded','user_added','verified')`
    ),
  ]
);

/**
 * What a given office actually does for the public.
 *
 * Distinct from `offices.category`, which is what *kind* of office it is. A
 * post office that runs an Aadhaar counter is `category: "post_office"` with
 * the `aadhaar` service — "the post office with Aadhaar" is not expressible
 * with the category enum alone, which is why this table exists.
 *
 * Also distinct from `complaints.serviceType`, which is free text describing
 * what the *reporter* was trying to do.
 */
export const OFFICE_SERVICES = [
  "aadhaar",
  "passport_seva",
  "pension",
  "banking",
  "vehicle_registration",
  "driving_licence",
  "fir",
  "land_records",
  "birth_death_certificate",
] as const;
export type OfficeService = (typeof OFFICE_SERVICES)[number];

export const officeServices = pgTable(
  "office_services",
  {
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.officeId, table.service] }),
    // Drives the "offices offering X" filter, which reads by service and
    // collects office ids — the reverse of the primary key's ordering.
    index("office_services_service_idx").on(table.service),
    check(
      "office_services_service_check",
      sql`${table.service} in ('aadhaar','passport_seva','pension','banking','vehicle_registration','driving_licence','fir','land_records','birth_death_certificate')`
    ),
  ]
);

export const CONSENT_TIERS = [
  "publish_named",
  "publish_anon",
  "escalate_only",
] as const;
export type ConsentTier = (typeof CONSENT_TIERS)[number];

export const COMPLAINT_STATUSES = [
  "pending",
  "published",
  "rejected",
  "tombstoned",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const complaints = pgTable(
  "complaints",
  {
    id: uuid("id").primaryKey(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id),
    // Opaque reporter identifier. Deliberately NOT a foreign key — the
    // reporter's actual identity lives in vault.reporter_identities.
    reporterId: uuid("reporter_id").notNull(),
    serviceType: text("service_type").notNull(),
    bribeAmount: integer("bribe_amount"),
    designation: text("designation"),
    officerNamePrivate: text("officer_name_private"),
    narrative: text("narrative").notNull(),
    consentTier: text("consent_tier").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    // YYYY-MM, used to bucket published complaints by month for public
    // display without exposing exact dates.
    publicMonth: text("public_month"),
  },
  (table) => [
    index("complaints_office_id_idx").on(table.officeId),
    index("complaints_reporter_id_idx").on(table.reporterId),
    index("complaints_pending_idx")
      .on(table.status)
      .where(sql`${table.status} = 'pending'`),
    check(
      "complaints_consent_tier_check",
      sql`${table.consentTier} in ('publish_named','publish_anon','escalate_only')`
    ),
    check(
      "complaints_status_check",
      sql`${table.status} in ('pending','published','rejected','tombstoned')`
    ),
  ]
);

export const chainEntries = pgTable("chain_entries", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  complaintId: uuid("complaint_id")
    .notNull()
    .unique()
    .references(() => complaints.id),
  prevHash: text("prev_hash").notNull(),
  entryHash: text("entry_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  removalReason: text("removal_reason"),
  orderRef: text("order_ref"),
});

export const chainCheckpoints = pgTable("chain_checkpoints", {
  id: uuid("id").primaryKey(),
  fromSeq: bigint("from_seq", { mode: "number" }).notNull(),
  toSeq: bigint("to_seq", { mode: "number" }).notNull(),
  headHash: text("head_hash").notNull(),
  signature: text("signature").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const OFFICER_STATUSES = ["hidden", "published"] as const;
export type OfficerStatus = (typeof OFFICER_STATUSES)[number];

export const officers = pgTable(
  "officers",
  {
    id: uuid("id").primaryKey(),
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id),
    nameNormalized: text("name_normalized").notNull(),
    designation: text("designation"),
    status: text("status").notNull(),
    replyText: text("reply_text"),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("officers_office_id_idx").on(table.officeId),
    uniqueIndex("officers_office_id_name_normalized_key").on(
      table.officeId,
      table.nameNormalized
    ),
    check(
      "officers_status_check",
      sql`${table.status} in ('hidden','published')`
    ),
  ]
);

export const TAKEDOWN_STATUSES = ["open", "actioned", "rejected"] as const;
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number];

export const takedownRequests = pgTable(
  "takedown_requests",
  {
    id: uuid("id").primaryKey(),
    complaintId: uuid("complaint_id").references(() => complaints.id),
    officerId: uuid("officer_id").references(() => officers.id),
    requesterContact: text("requester_contact").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    orderRef: text("order_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "takedown_requests_status_check",
      sql`${table.status} in ('open','actioned','rejected')`
    ),
  ]
);

export const moderationActions = pgTable("moderation_actions", {
  id: uuid("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const officeViewCounts = pgTable(
  "office_view_counts",
  {
    officeId: uuid("office_id")
      .notNull()
      .references(() => offices.id),
    day: date("day", { mode: "date" }).notNull(),
    views: integer("views").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.officeId, table.day] })]
);

export const sessions = pgTable("sessions", {
  // Random token hash, not a uuid — the raw session token never touches the
  // database; only its hash is stored here.
  id: text("id").primaryKey(),
  reporterId: uuid("reporter_id").notNull(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey(),
    emailHmac: text("email_hmac").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("otp_codes_email_hmac_idx").on(table.emailHmac)]
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  count: integer("count").notNull().default(0),
});

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey(),
    jobName: text("job_name").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "date",
    }),
    ok: boolean("ok"),
    detail: text("detail"),
  },
  (table) => [
    index("job_runs_job_name_started_at_idx").on(
      table.jobName,
      table.startedAt
    ),
  ]
);
