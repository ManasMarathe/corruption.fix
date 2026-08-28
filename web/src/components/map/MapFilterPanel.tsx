"use client";

import { useEffect, useRef, useState } from "react";
import type { OfficeCategory, OfficeService } from "@/db/schema";
import { CATEGORY_COLORS, CATEGORY_LIST } from "@/lib/categories";
import { SERVICE_LIST } from "@/lib/services";
import { strings } from "@/lib/strings";

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
function activeFilterCount(filters: MapFilters): number {
  let count = 0;
  if (filters.categories.size !== CATEGORY_LIST.length) count++;
  if (filters.services.size > 0) count++;
  if (filters.withReportsOnly) count++;
  if (filters.includeApproximate) count++;
  return count;
}

/**
 * Replaces CategoryFilterBar: the 6 category chips plus the newer service /
 * "has reports" / "include approximate" dimensions, all behind one "Filters"
 * trigger so the top chrome bar stays to a handful of controls instead of
 * growing a chip per dimension.
 */
export function MapFilterPanel({
  filters,
  onChange,
}: {
  filters: MapFilters;
  onChange: (next: MapFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape and on a click outside the trigger/panel — same pattern
  // as LocationPrompt's Escape handling, plus an outside-click check since,
  // unlike LocationPrompt, this isn't a modal with a backdrop to click.
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  function toggleCategory(category: OfficeCategory) {
    const next = new Set(filters.categories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    onChange({ ...filters, categories: next });
  }

  function toggleService(service: OfficeService) {
    const next = new Set(filters.services);
    if (next.has(service)) next.delete(service);
    else next.add(service);
    onChange({ ...filters, services: next });
  }

  const activeCount = activeFilterCount(filters);

  return (
    // `relative` anchors the absolutely-positioned popover below.
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity ${
          activeCount > 0
            ? "border-black/10 dark:border-white/20 bg-white/90 dark:bg-black/60 opacity-100"
            : "border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/30 opacity-80"
        }`}
      >
        {strings.map.filters.button}
        {activeCount > 0 ? (
          <span className="text-black/50 dark:text-white/50">
            {strings.map.filters.activeCount(activeCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={strings.map.filters.heading}
          // z-20: above the chrome bar it's anchored in (z-10), below the
          // location prompt (z-30) and the chat panel (z-40).
          className="absolute left-0 top-full z-20 mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-lg border border-black/10 dark:border-white/20 bg-white dark:bg-neutral-950 p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{strings.map.filters.heading}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={strings.map.filters.close}
              className="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
            >
              ✕
            </button>
          </div>

          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-black/60 dark:text-white/60">
              {strings.map.filters.categoriesLabel}
            </legend>
            <div className="mt-1.5 flex flex-col gap-1">
              {CATEGORY_LIST.map((category) => (
                <label
                  key={category}
                  className="flex items-center gap-2 text-sm py-0.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={filters.categories.has(category)}
                    onChange={() => toggleCategory(category)}
                    className="rounded border-black/20 dark:border-white/30"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: CATEGORY_COLORS[category] }}
                    aria-hidden
                  />
                  {strings.map.categories[category]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-black/60 dark:text-white/60">
              {strings.map.filters.servicesLabel}
            </legend>
            <div className="mt-1.5 flex flex-col gap-1">
              {SERVICE_LIST.map((service) => (
                <label
                  key={service}
                  className="flex items-center gap-2 text-sm py-0.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={filters.services.has(service)}
                    onChange={() => toggleService(service)}
                    className="rounded border-black/20 dark:border-white/30"
                  />
                  {strings.map.services[service]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-col gap-2 border-t border-black/10 dark:border-white/10 pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filters.withReportsOnly}
                onChange={(e) => onChange({ ...filters, withReportsOnly: e.target.checked })}
                className="rounded border-black/20 dark:border-white/30"
              />
              {strings.map.filters.withReportsLabel}
            </label>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeApproximate}
                onChange={(e) => onChange({ ...filters, includeApproximate: e.target.checked })}
                className="mt-0.5 rounded border-black/20 dark:border-white/30"
              />
              <span>
                {strings.map.filters.approximateLabel}
                <span className="block text-xs text-black/50 dark:text-white/50">
                  {strings.map.filters.approximateHint}
                </span>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => onChange(defaultMapFilters())}
            className="mt-4 text-sm underline text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
          >
            {strings.map.filters.reset}
          </button>
        </div>
      ) : null}
    </div>
  );
}
