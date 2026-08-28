CREATE TABLE "office_services" (
	"office_id" uuid NOT NULL,
	"service" text NOT NULL,
	CONSTRAINT "office_services_office_id_service_pk" PRIMARY KEY("office_id","service"),
	CONSTRAINT "office_services_service_check" CHECK ("office_services"."service" in ('aadhaar','passport_seva','pension','banking','vehicle_registration','driving_licence','fir','land_records','birth_death_certificate'))
);
--> statement-breakpoint
ALTER TABLE "offices" DROP CONSTRAINT "offices_source_check";--> statement-breakpoint
ALTER TABLE "offices" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "offices" ADD COLUMN "location_precision" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "office_services" ADD CONSTRAINT "office_services_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_services_service_idx" ON "office_services" USING btree ("service");--> statement-breakpoint
CREATE UNIQUE INDEX "offices_source_ref_key" ON "offices" USING btree ("source","source_ref") WHERE "offices"."source_ref" is not null;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_location_precision_check" CHECK ("offices"."location_precision" in ('exact','approximate'));--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_source_check" CHECK ("offices"."source" in ('osm','user','indiapost','uidai','parivahan','ecourts','police'));