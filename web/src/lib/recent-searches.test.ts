import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  parseRecentSearches,
  readRecentSearches,
  recentFromOffice,
  recentFromPlace,
  RECENT_SEARCHES_KEY,
  RECENT_SEARCH_LIMIT,
  writeRecentSearches,
  type RecentSearch,
} from "./recent-searches";

/**
 * Same contract as saved-location.ts: hostile or stale localStorage content
 * must degrade to "no recents", never throw into the search box.
 */

function stubStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

function throwingStorage(): Storage {
  return new Proxy({} as Storage, {
    get() {
      throw new Error("site data blocked");
    },
  });
}

const office = recentFromOffice({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Shivajinagar Police Station",
  category: "police",
  lng: 73.85,
  lat: 18.52,
});

const place = recentFromPlace({
  key: "relation:1",
  name: "Pune, Maharashtra, India",
  shortName: "Pune",
  bbox: [73.7, 18.4, 74.0, 18.7],
  center: [73.85, 18.55],
});

describe("parseRecentSearches", () => {
  it("returns [] for null, malformed JSON and non-arrays", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("{oh no")).toEqual([]);
    expect(parseRecentSearches('{"kind":"place"}')).toEqual([]);
  });

  it("round-trips valid entries", () => {
    expect(parseRecentSearches(JSON.stringify([place, office]))).toEqual([place, office]);
  });

  it("drops a bad entry without discarding its neighbours", () => {
    const raw = JSON.stringify([place, { v: 1, kind: "office", id: "x" }, office]);
    expect(parseRecentSearches(raw)).toEqual([place, office]);
  });

  it("rejects an out-of-range bbox and an unknown category", () => {
    const badBbox = { ...place, bbox: [200, 18.4, 74, 18.7] };
    const badCategory = { ...office, category: "spaceport" };
    expect(parseRecentSearches(JSON.stringify([badBbox, badCategory]))).toEqual([]);
  });

  it("rejects a future version rather than guessing at a migration", () => {
    expect(parseRecentSearches(JSON.stringify([{ ...place, v: 2 }]))).toEqual([]);
  });
});

describe("addRecentSearch", () => {
  it("puts the newest entry first", () => {
    expect(addRecentSearch([place], office)).toEqual([office, place]);
  });

  it("moves a re-picked entry to the top instead of duplicating it", () => {
    const list = addRecentSearch([office, place], place);
    expect(list).toEqual([place, office]);
  });

  it("caps the list", () => {
    let list: RecentSearch[] = [];
    for (let i = 0; i < RECENT_SEARCH_LIMIT + 3; i++) {
      list = addRecentSearch(list, { ...place, key: `relation:${i}` });
    }
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list[0]).toMatchObject({ key: `relation:${RECENT_SEARCH_LIMIT + 2}` });
  });
});

describe("storage access", () => {
  it("reads and writes through an injected Storage", () => {
    const storage = stubStorage();
    writeRecentSearches([place, office], storage);
    expect(readRecentSearches(storage)).toEqual([place, office]);
    expect(storage.getItem(RECENT_SEARCHES_KEY)).toBeTruthy();
  });

  it("survives storage that throws on access", () => {
    expect(readRecentSearches(throwingStorage())).toEqual([]);
    expect(() => writeRecentSearches([place], throwingStorage())).not.toThrow();
  });

  it("treats a missing storage as empty", () => {
    expect(readRecentSearches(null)).toEqual([]);
    expect(() => writeRecentSearches([place], null)).not.toThrow();
  });
});
