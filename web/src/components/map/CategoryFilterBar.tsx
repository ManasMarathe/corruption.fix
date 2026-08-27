"use client";

import { CATEGORY_COLORS, CATEGORY_LIST } from "@/lib/categories";
import { strings } from "@/lib/strings";
import type { OfficeCategory } from "@/db/schema";

/**
 * Category filter chips, doubling as the map's legend (each chip shows the
 * category's fill color). On mobile this collapses into a single
 * horizontally-scrollable row instead of a full sheet — simpler, and still
 * keeps every chip reachable without covering the map.
 */
export function CategoryFilterBar({
  active,
  onToggle,
}: {
  active: ReadonlySet<OfficeCategory>;
  onToggle: (category: OfficeCategory) => void;
}) {
  return (
    <div
      role="group"
      aria-label={strings.map.legendTitle}
      className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 sm:pb-0 max-w-full"
    >
      {CATEGORY_LIST.map((category) => {
        const isActive = active.has(category);
        return (
          <button
            key={category}
            type="button"
            onClick={() => onToggle(category)}
            aria-pressed={isActive}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity ${
              isActive
                ? "border-black/10 dark:border-white/20 bg-white/90 dark:bg-black/60 opacity-100"
                : "border-black/10 dark:border-white/20 bg-white/50 dark:bg-black/30 opacity-45"
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: CATEGORY_COLORS[category] }}
              aria-hidden
            />
            {strings.map.categories[category]}
          </button>
        );
      })}
    </div>
  );
}
