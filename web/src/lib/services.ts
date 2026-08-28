import type { OfficeService } from "@/db/schema";

/**
 * Client-safe mirror of `OFFICE_SERVICES` from `@/db/schema`, and the labels
 * for the map's service filter.
 *
 * Duplicated rather than importing the runtime array from schema.ts for the
 * same reason as `categories.ts`: map components must never pull
 * drizzle-orm/pg-core into the client bundle. Only the `OfficeService`
 * *type* is imported, and types are erased at compile time.
 *
 * `SERVICE_LIST` is checked against the schema's array by
 * services.test.ts, so the two cannot drift silently.
 */
export const SERVICE_LIST: OfficeService[] = [
  "aadhaar",
  "passport_seva",
  "pension",
  "banking",
  "vehicle_registration",
  "driving_licence",
  "fir",
  "land_records",
  "birth_death_certificate",
];
