"use client";

import { CATEGORY_COLORS } from "@/lib/categories";
import { formatDistanceKm } from "@/lib/distance";
import { strings } from "@/lib/strings";
import type { OfficeCategory } from "@/db/schema";

/**
 * One row of the viewport list. `id` is the app's office uuid when known;
 * pmtiles features only carry `osm_uid` until /api/offices/lookup resolves
 * them, which is why selecting a row goes back through MapHome's existing
 * popup path rather than linking straight to /office/[id].
 */
export interface VisibleOffice {
  /** Stable list key: the office uuid, or `osm:<uid>` for an unresolved pin. */
  key: string;
  id: string | null;
  osmUid: number | null;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
  /** Great-circle km from the centre of the current view. */
  distanceKm: number;
}

/**
 * "What is on this screen", as a list.
 *
 * The rows come from `map.queryRenderedFeatures`, not from an API call: the
 * ~180k OSM/government offices live in the pmtiles vector source while
 * /api/offices?bbox= returns only user-added ones, so querying what maplibre
 * has actually drawn is the single source that covers both — and it inherits
 * the active filters and the zoom floor for free.
 */
export function OfficeListPanel({
  open,
  offices,
  belowMinZoom,
  truncated,
  staleArea,
  onSearchThisArea,
  onSelect,
  onHighlight,
  onClose,
}: {
  open: boolean;
  offices: VisibleOffice[];
  belowMinZoom: boolean;
  /** True when the map drew more than the list shows. */
  truncated: boolean;
  /** The view moved since the list was built, so it may be out of date. */
  staleArea: boolean;
  onSearchThisArea: () => void;
  onSelect: (office: VisibleOffice) => void;
  onHighlight: (office: VisibleOffice | null) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    // Desktop: a column under the top chrome bar. Mobile: a bottom sheet, so
    // it never covers the search box it was opened from. z-10 keeps it in the
    // chrome layer — below the search dropdown and filter popover (z-20),
    // which can overhang it.
    <div className="absolute z-10 inset-x-0 bottom-0 max-h-[45dvh] sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-32 sm:w-80 sm:max-h-[calc(100dvh-11rem)] flex flex-col rounded-t-2xl sm:rounded-lg border border-black/10 dark:border-white/20 bg-white/98 dark:bg-neutral-900/98 shadow-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-black/10 dark:border-white/10">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{strings.map.list.heading}</h2>
          {!belowMinZoom ? (
            <p className="text-xs text-black/50 dark:text-white/50">
              {truncated
                ? strings.map.list.truncated(offices.length)
                : strings.map.list.count(offices.length)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={strings.map.list.close}
          onClick={onClose}
          className="shrink-0 text-black/60 dark:text-white/60 hover:opacity-70 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {staleArea && !belowMinZoom ? (
        <div className="px-4 py-2 border-b border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onSearchThisArea}
            className="w-full rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-medium hover:opacity-90"
          >
            {strings.map.list.searchThisArea}
          </button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto" onMouseLeave={() => onHighlight(null)}>
        {belowMinZoom ? (
          <p className="px-4 py-6 text-sm text-black/50 dark:text-white/50">
            {strings.map.zoomInForOffices}
          </p>
        ) : offices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-black/50 dark:text-white/50">
            {strings.map.list.empty}
          </p>
        ) : (
          <ul>
            {offices.map((office) => (
              <li key={office.key}>
                <button
                  type="button"
                  onClick={() => onSelect(office)}
                  onMouseEnter={() => onHighlight(office)}
                  onFocus={() => onHighlight(office)}
                  className="w-full text-left px-4 py-2.5 flex items-start gap-2 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span
                    className="w-2 h-2 mt-1.5 rounded-full shrink-0"
                    style={{ background: CATEGORY_COLORS[office.category] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">
                      {office.name || strings.map.categories[office.category]}
                    </span>
                    <span className="block text-xs text-black/50 dark:text-white/50">
                      {strings.map.categories[office.category]}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-black/40 dark:text-white/40 mt-0.5">
                    {formatDistanceKm(office.distanceKm)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
