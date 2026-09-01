import type { OfficeCategory, OfficeService } from "@/db/schema";
import { CATEGORY_LIST } from "./categories";

/**
 * The map's filter state.
 *
 * Lives here rather than in MapFilterPanel.tsx so that plain modules — and
 * `node`-environment vitest runs — can build and compare filter values
 * without importing a `"use client"` component (and, through it, React).
 * `map-url.ts` is the reason this move mattered: URL round-tripping is pure
 * logic and deserves a unit test, not a DOM.
 */
export interface MapFilters {
  categories: Set<OfficeCategory>;
  services: Set<OfficeService>;
  withReportsOnly: boolean;
  includeApproximate: boolean;
}

/**
 * The map's default view: every category shown, no service narrowed, no
 * "has reports" gate, and approximate (pincode-centroid) locations hidden —
 * see the comment on `approximateHint` in strings.ts for why that one
 * defaults off rather than on like everything else.
 */
export function defaultMapFilters(): MapFilters {
  return {
    categories: new Set(CATEGORY_LIST),
    services: new Set(),
    withReportsOnly: false,
    includeApproximate: false,
  };
}

/** Number of filter *dimensions* narrowed from the default, for the trigger badge. */
export function activeFilterCount(filters: MapFilters): number {
  let count = 0;
  if (filters.categories.size !== CATEGORY_LIST.length) count++;
  if (filters.services.size > 0) count++;
  if (filters.withReportsOnly) count++;
  if (filters.includeApproximate) count++;
  return count;
}
