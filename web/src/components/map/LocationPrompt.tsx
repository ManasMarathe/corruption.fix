"use client";

import { useEffect, useRef, useState } from "react";
import type { GeocodePlace } from "@/lib/geocode";
import { strings } from "@/lib/strings";

/**
 * First-run overlay asking the visitor where they are, plus the place
 * combobox it wraps (the combobox has no other consumer).
 *
 * Mechanics are lifted from OfficeSearchBox: a debounced effect on `query`,
 * a monotonic request counter to discard stale responses, and a delayed blur
 * so a click on a result lands before the list unmounts. Two deliberate
 * differences: a longer debounce and a three-character minimum, both to keep
 * request volume within the geocoder's usage policy (see
 * src/app/api/geocode/route.ts).
 */

const DEBOUNCE_MS = 600;
const MIN_QUERY_LENGTH = 3;

export function LocationPrompt({
  onSelect,
  onSkip,
}: {
  onSelect: (place: GeocodePlace) => void;
  /** Also the Escape handler — dismissing without choosing is a skip. */
  onSkip: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodePlace[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setFailed(false);
      fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((body: { results: GeocodePlace[] }) => {
          if (requestIdRef.current !== requestId) return;
          setResults(body.results);
          setLoading(false);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          // Unlike office search, a failure here is worth surfacing: the
          // visitor is blocked on this input, not browsing past it.
          setResults([]);
          setFailed(true);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onSkip();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSkip]);

  const showList = open && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    // z-30 sits above the map chrome (z-10) and the office-search dropdown
    // (z-20), but below the chat panel (z-40) so opening chat still wins.
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/30 dark:bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-prompt-heading"
        className="w-full max-w-sm rounded-lg border border-black/10 dark:border-white/20 bg-white dark:bg-neutral-950 p-5 shadow-lg"
      >
        <h2 id="location-prompt-heading" className="text-base font-semibold">
          {strings.map.location.heading}
        </h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {strings.map.location.body}
        </p>

        {/* `relative` anchors the absolutely-positioned results list. */}
        <div className="relative mt-4">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay so a click on a result registers before the list unmounts.
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder={strings.map.location.inputPlaceholder}
            aria-label={strings.map.location.heading}
            className="w-full rounded-full border border-black/10 dark:border-white/20 bg-white/95 dark:bg-black/70 px-4 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
          />
          {showList ? (
            <ul className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-black/10 dark:border-white/20 bg-white/98 dark:bg-neutral-900/98 shadow-lg text-sm z-20">
              {loading ? (
                <li className="px-4 py-2 text-black/50 dark:text-white/50">
                  {strings.map.location.searching}
                </li>
              ) : failed ? (
                <li className="px-4 py-2 text-black/50 dark:text-white/50">
                  {strings.map.location.failed}
                </li>
              ) : results.length === 0 ? (
                <li className="px-4 py-2 text-black/50 dark:text-white/50">
                  {strings.map.location.noResults}
                </li>
              ) : (
                results.map((place) => (
                  <li key={place.key}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(false);
                        onSelect(place);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <span className="block font-medium truncate">{place.shortName}</span>
                      <span className="block text-xs text-black/40 dark:text-white/40 truncate">
                        {place.name}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="mt-4 text-sm underline text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
        >
          {strings.map.location.skip}
        </button>
      </div>
    </div>
  );
}
