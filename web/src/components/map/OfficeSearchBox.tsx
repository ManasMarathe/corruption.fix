"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CATEGORY_COLORS } from "@/lib/categories";
import type { GeocodePlace } from "@/lib/geocode";
import {
  addRecentSearch,
  readRecentSearches,
  recentFromOffice,
  recentFromPlace,
  writeRecentSearches,
  type RecentOffice,
  type RecentPlace,
  type RecentSearch,
} from "@/lib/recent-searches";
import { strings } from "@/lib/strings";
import type { OfficeCategory } from "@/db/schema";

export interface OfficeSearchResult {
  id: string;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
}

const DEBOUNCE_MS = 300;

/**
 * /api/geocode rejects anything shorter (see `invalidPlaceQuery`), so the
 * place half of the search stays quiet until the query is worth an upstream
 * Nominatim call. The office half has no such floor — one letter is a valid
 * ILIKE prefix.
 */
const PLACE_MIN_CHARS = 3;

/** A flattened, keyboard-navigable row. Order here is the arrow-key order. */
type Row =
  | { kind: "recent"; entry: RecentSearch }
  | { kind: "place"; place: GeocodePlace }
  | { kind: "office"; office: OfficeSearchResult };

/** A recent place carries only what the map needs; rebuild the rest. */
function placeFromRecent(entry: RecentPlace): GeocodePlace {
  const [west, south, east, north] = entry.bbox;
  return {
    key: entry.key,
    name: entry.name,
    shortName: entry.name,
    bbox: entry.bbox,
    center: [(west + east) / 2, (south + north) / 2],
  };
}

/**
 * The map's single search box: places *and* offices, with keyboard
 * navigation and a recents list.
 *
 * Previously this searched offices by name only, and the sole way to jump to
 * a city was the first-visit LocationPrompt modal — so "take me to Jaipur"
 * had no entry point once that modal had been answered. Both halves now run
 * on the same debounce and share one monotonic request id, so a slow
 * Nominatim response can never overwrite the results of a newer query.
 */
export function OfficeSearchBox({
  onSelectOffice,
  onSelectPlace,
  inputRef: externalInputRef,
}: {
  onSelectOffice: (result: OfficeSearchResult) => void;
  onSelectPlace: (place: GeocodePlace) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [offices, setOffices] = useState<OfficeSearchResult[]>([]);
  const [places, setPlaces] = useState<GeocodePlace[]>([]);
  const [recents, setRecents] = useState<RecentSearch[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const listboxId = useId();

  // Populated in an effect rather than a lazy useState initializer: MapHome
  // is server-rendered, so reading localStorage during render would give the
  // server "no recents" and the client a list, and mismatch.
  useEffect(() => {
    setRecents(readRecentSearches());
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // Bump the request id so an in-flight response for a query the user
      // has since cleared doesn't repopulate the list.
      requestIdRef.current++;
      setOffices([]);
      setPlaces([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);

      const officeRequest = fetch(`/api/offices/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((body: { results: OfficeSearchResult[] }) => body.results)
        .catch(() => [] as OfficeSearchResult[]);

      const placeRequest =
        trimmed.length < PLACE_MIN_CHARS
          ? Promise.resolve([] as GeocodePlace[])
          : fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`)
              .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
              .then((body: { results: GeocodePlace[] }) => body.results)
              // A geocode 429/502 must not take the office results down with
              // it — the two halves fail independently.
              .catch(() => [] as GeocodePlace[]);

      void Promise.all([placeRequest, officeRequest]).then(([placeResults, officeResults]) => {
        if (requestIdRef.current !== requestId) return;
        setPlaces(placeResults);
        setOffices(officeResults);
        setLoading(false);
        setHighlight(-1);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Outside-click close. Replaces a 150ms blur setTimeout, which raced with
  // keyboard selection and closed the list whenever focus moved anywhere.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const showingRecents = query.trim().length === 0;
  const rows: Row[] = showingRecents
    ? recents.map((entry) => ({ kind: "recent", entry }) as const)
    : [
        ...places.map((place) => ({ kind: "place", place }) as const),
        ...offices.map((office) => ({ kind: "office", office }) as const),
      ];

  function remember(entry: RecentSearch) {
    const next = addRecentSearch(readRecentSearches(), entry);
    writeRecentSearches(next);
    setRecents(next);
  }

  function choosePlace(place: GeocodePlace) {
    remember(recentFromPlace(place));
    setQuery(place.shortName);
    setOpen(false);
    onSelectPlace(place);
  }

  function chooseOffice(office: OfficeSearchResult) {
    remember(recentFromOffice(office));
    setQuery(office.name);
    setOpen(false);
    onSelectOffice(office);
  }

  function choose(row: Row) {
    if (row.kind === "place") return choosePlace(row.place);
    if (row.kind === "office") return chooseOffice(row.office);
    return row.entry.kind === "place"
      ? choosePlace(placeFromRecent(row.entry))
      : chooseOffice(row.entry);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Doesn't clear the query: Escape here means "put the dropdown away",
      // and the global Escape handler in MapHome closes the popup instead.
      setOpen(false);
      e.stopPropagation();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        const next = current + delta;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      // With nothing highlighted, Enter takes the first result — the same
      // "just go" behaviour as pressing Enter in a browser address bar.
      const row = rows[highlight] ?? rows[0];
      if (!row) return;
      e.preventDefault();
      choose(row);
    }
  }

  const listVisible = open && (rows.length > 0 || (!showingRecents && query.trim().length > 0));

  function rowId(index: number): string {
    return `${listboxId}-row-${index}`;
  }

  function renderRow(row: Row, index: number) {
    const active = index === highlight;
    const rowClass = `w-full text-left px-4 py-2 flex items-center gap-2 ${
      active ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/10"
    }`;

    const isPlace = row.kind === "place" || (row.kind === "recent" && row.entry.kind === "place");
    const label =
      row.kind === "place"
        ? row.place.shortName
        : row.kind === "office"
          ? row.office.name
          : row.entry.name;
    const detail =
      row.kind === "place"
        ? row.place.name
        : row.kind === "office"
          ? strings.map.categories[row.office.category]
          : row.entry.kind === "office"
            ? strings.map.categories[row.entry.category]
            : "";

    return (
      <li key={`${row.kind}-${index}-${label}`} id={rowId(index)} role="option" aria-selected={active}>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setHighlight(index)}
          onClick={() => choose(row)}
          className={rowClass}
        >
          {isPlace ? (
            <span className="shrink-0 text-black/40 dark:text-white/40" aria-hidden>
              ◎
            </span>
          ) : (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background:
                  CATEGORY_COLORS[
                    row.kind === "office"
                      ? row.office.category
                      : (row.entry as RecentOffice).category
                  ],
              }}
              aria-hidden
            />
          )}
          <span className="truncate">{label}</span>
          {detail ? (
            <span className="ml-auto text-xs text-black/40 dark:text-white/40 shrink-0 max-w-[45%] truncate">
              {detail}
            </span>
          ) : null}
        </button>
      </li>
    );
  }

  const headingClass =
    "px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40";

  return (
    <div ref={containerRef} className="relative w-full sm:w-80">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={listVisible}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? rowId(highlight) : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={strings.map.searchPlaceholder}
        aria-label={strings.map.searchAriaLabel}
        className="w-full rounded-full border border-black/10 dark:border-white/20 bg-white/95 dark:bg-black/70 px-4 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
      />
      {listVisible ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-lg border border-black/10 dark:border-white/20 bg-white/98 dark:bg-neutral-900/98 shadow-lg text-sm z-20"
        >
          {showingRecents ? (
            <>
              <li className={headingClass} role="presentation">
                {strings.map.searchRecentHeading}
              </li>
              {rows.map(renderRow)}
            </>
          ) : loading && rows.length === 0 ? (
            <li className="px-4 py-2 text-black/50 dark:text-white/50" role="presentation">
              {strings.map.searchLoading}
            </li>
          ) : rows.length === 0 ? (
            <li className="px-4 py-2 text-black/50 dark:text-white/50" role="presentation">
              {strings.map.searchNoResults}
            </li>
          ) : (
            <>
              {places.length > 0 ? (
                <>
                  <li className={headingClass} role="presentation">
                    {strings.map.searchPlacesHeading}
                  </li>
                  {rows.slice(0, places.length).map(renderRow)}
                </>
              ) : null}
              {offices.length > 0 ? (
                <>
                  <li className={headingClass} role="presentation">
                    {strings.map.searchOfficesHeading}
                  </li>
                  {rows
                    .slice(places.length)
                    .map((row, i) => renderRow(row, places.length + i))}
                </>
              ) : null}
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}
