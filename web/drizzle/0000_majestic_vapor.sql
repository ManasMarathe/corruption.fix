-- Required for the `geometry` column type used by "offices".
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "identity_vault";
--> statement-breakpoint
CREATE TABLE "chain_checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_seq" bigint NOT NULL,
	"to_seq" bigint NOT NULL,
	"head_hash" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_entries" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"complaint_id" uuid NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"order_ref" text,
	CONSTRAINT "chain_entries_complaint_id_unique" UNIQUE("complaint_id")
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"office_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"service_type" text NOT NULL,
	"bribe_amount" integer,
	"designation" text,
	"officer_name_private" text,
	"narrative" text NOT NULL,
	"consent_tier" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"public_month" text,
	CONSTRAINT "complaints_consent_tier_check" CHECK ("complaints"."consent_tier" in ('publish_named','publish_anon','escalate_only')),
	CONSTRAINT "complaints_status_check" CHECK ("complaints"."status" in ('pending','published','rejected','tombstoned'))
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lgd_code" integer NOT NULL,
	"name" text NOT NULL,
	"state_id" uuid NOT NULL,
	CONSTRAINT "districts_lgd_code_unique" UNIQUE("lgd_code")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_view_counts" (
	"office_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "office_view_counts_office_id_day_pk" PRIMARY KEY("office_id","day")
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"office_id" uuid NOT NULL,
	"name_normalized" text NOT NULL,
	"designation" text,
	"status" text NOT NULL,
	"reply_text" text,
	"published_at" timestamp with time zone,
	CONSTRAINT "officers_status_check" CHECK ("officers"."status" in ('hidden','published'))
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"geom" geometry(Point,4326) NOT NULL,
	"address" text,
	"district_id" uuid,
	"source" text NOT NULL,
	"osm_id" bigint,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offices_osm_id_unique" UNIQUE("osm_id"),
	CONSTRAINT "offices_category_check" CHECK ("offices"."category" in ('police','post_office','court','govt_office','rto','other')),
	CONSTRAINT "offices_source_check" CHECK ("offices"."source" in ('osm','user')),
	CONSTRAINT "offices_status_check" CHECK ("offices"."status" in ('seeded','user_added','verified'))
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_hmac" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_vault"."reporter_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_enc" text NOT NULL,
	"email_hmac" text NOT NULL,
	"phone_enc" text,
	"phone_hmac" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporter_identities_email_hmac_unique" UNIQUE("email_hmac"),
	CONSTRAINT "reporter_identities_phone_hmac_unique" UNIQUE("phone_hmac")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lgd_code" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "states_lgd_code_unique" UNIQUE("lgd_code")
);
--> statement-breakpoint
CREATE TABLE "takedown_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"complaint_id" uuid,
	"officer_id" uuid,
	"requester_contact" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"order_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "takedown_requests_status_check" CHECK ("takedown_requests"."status" in ('open','actioned','rejected'))
);
--> statement-breakpoint
CREATE TABLE "identity_vault"."vault_access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"accessor" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_entries" ADD CONSTRAINT "chain_entries_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_view_counts" ADD CONSTRAINT "office_view_counts_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaints_office_id_idx" ON "complaints" USING btree ("office_id");--> statement-breakpoint
CREATE INDEX "complaints_reporter_id_idx" ON "complaints" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "complaints_pending_idx" ON "complaints" USING btree ("status") WHERE "complaints"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE INDEX "officers_office_id_idx" ON "officers" USING btree ("office_id");--> statement-breakpoint
CREATE UNIQUE INDEX "officers_office_id_name_normalized_key" ON "officers" USING btree ("office_id","name_normalized");--> statement-breakpoint
CREATE INDEX "offices_district_id_idx" ON "offices" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "offices_category_idx" ON "offices" USING btree ("category");--> statement-breakpoint
CREATE INDEX "otp_codes_email_hmac_idx" ON "otp_codes" USING btree ("email_hmac");--> statement-breakpoint
CREATE INDEX "offices_geom_gix" ON "offices" USING gist ("geom");