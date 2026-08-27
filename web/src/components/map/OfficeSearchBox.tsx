"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLORS } from "@/lib/categories";
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

export function OfficeSearchBox({
  onSelect,
}: {
  onSelect: (result: OfficeSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficeSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      fetch(`/api/offices/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((body: { results: OfficeSearchResult[] }) => {
          if (requestIdRef.current !== requestId) return;
          setResults(body.results);
          setLoading(false);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative w-full sm:w-80">
      <input
        type="text"
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
        placeholder={strings.map.searchPlaceholder}
        aria-label={strings.map.searchPlaceholder}
        className="w-full rounded-full border border-black/10 dark:border-white/20 bg-white/95 dark:bg-black/70 px-4 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
      />
      {open && query.trim().length > 0 ? (
        <ul className="absolute left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-lg border border-black/10 dark:border-white/20 bg-white/98 dark:bg-neutral-900/98 shadow-lg text-sm z-20">
          {loading ? (
            <li className="px-4 py-2 text-black/50 dark:text-white/50">
              {strings.map.searchLoading}
            </li>
          ) : results.length === 0 ? (
            <li className="px-4 py-2 text-black/50 dark:text-white/50">
              {strings.map.searchNoResults}
            </li>
          ) : (
            results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(result);
                    setQuery(result.name);
                    setOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: CATEGORY_COLORS[result.category] }}
                    aria-hidden
                  />
                  <span className="truncate">{result.name}</span>
                  <span className="ml-auto text-xs text-black/40 dark:text-white/40 shrink-0">
                    {strings.map.categories[result.category]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
