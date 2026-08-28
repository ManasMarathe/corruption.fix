"use client";

import { strings } from "@/lib/strings";

/**
 * The persistent "change your area" affordance in the map chrome. Styled as
 * a CategoryFilterBar chip so the top bar reads as one set of controls.
 *
 * `name` is null when the visitor skipped the prompt or hasn't answered it
 * yet — the chip is then the only way back to it.
 */
export function LocationChip({
  name,
  onClick,
}: {
  name: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={strings.map.location.changeAriaLabel}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/20 bg-white/90 dark:bg-black/60 px-3 py-1.5 text-xs font-medium max-w-full"
    >
      <span aria-hidden>📍</span>
      <span className="truncate">
        {name ? strings.map.location.currentArea(name) : strings.map.location.setLocation}
      </span>
    </button>
  );
}
