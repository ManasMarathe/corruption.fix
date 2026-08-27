import type { OfficeCategory } from "@/db/schema";

/**
 * Client-safe mirror of `OFFICE_CATEGORIES` from `@/db/schema`. Duplicated
 * (rather than importing the runtime array from schema.ts) so map
 * components never pull drizzle-orm/pg-core into the client bundle — only
 * the `OfficeCategory` *type* is imported from schema.ts, which is erased
 * at compile time. Keep this list in sync with `OFFICE_CATEGORIES`.
 */
export const CATEGORY_LIST: OfficeCategory[] = [
  "police",
  "post_office",
  "court",
  "govt_office",
  "rto",
  "other",
];

/**
 * Distinct, colorblind-friendly (Okabe-Ito derived) colors per category,
 * used for map circle fills, the legend/filter chips, and category dots
 * elsewhere in the UI.
 */
export const CATEGORY_COLORS: Record<OfficeCategory, string> = {
  police: "#2563eb", // blue
  post_office: "#16a34a", // green
  court: "#9333ea", // purple
  govt_office: "#ea580c", // orange
  rto: "#0891b2", // teal
  other: "#6b7280", // gray
};

/**
 * A MapLibre `["match", ["get", "category"], ...]` expression mapping the
 * `category` feature property (present on both the pmtiles `offices` layer
 * and the user-added GeoJSON source) to its color. Shared by both circle
 * layers so OSM-sourced and user-added pins are colored identically.
 */
export function categoryColorExpression(): unknown[] {
  const expression: unknown[] = ["match", ["get", "category"]];
  for (const category of CATEGORY_LIST) {
    expression.push(category, CATEGORY_COLORS[category]);
  }
  expression.push(CATEGORY_COLORS.other); // fallback
  return expression;
}
