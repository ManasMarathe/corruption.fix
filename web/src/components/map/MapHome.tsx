"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  CircleLayerSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup as MapLibrePopup,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { DataDrivenPropertyValueSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { OfficeCategory } from "@/db/schema";
import { CATEGORY_COLORS, CATEGORY_LIST, categoryColorExpression } from "@/lib/categories";
import { strings } from "@/lib/strings";
import { CategoryFilterBar } from "./CategoryFilterBar";
import { OfficeSearchBox, type OfficeSearchResult } from "./OfficeSearchBox";

// Dynamically imported at runtime (see the init effect below) — maplibre-gl
// touches `window`/WebGL at import time, which crashes under Next's SSR
// pass. A plain `typeof import(...)` type reference is compile-time only
// and safe to use anywhere.
type MaplibreModule = typeof import("maplibre-gl");

const OSM_SOURCE_ID = "offices";
const OSM_SOURCE_LAYER = "offices";
const USER_SOURCE_ID = "user-offices";
const OSM_CIRCLE_LAYER = "offices-circle";
const OSM_LABEL_LAYER = "offices-label";
const USER_CIRCLE_LAYER = "user-offices-circle";
const USER_LABEL_LAYER = "user-offices-label";
const CLICKABLE_LAYERS = [OSM_CIRCLE_LAYER, USER_CIRCLE_LAYER];
const FILTERABLE_LAYERS = [OSM_CIRCLE_LAYER, OSM_LABEL_LAYER, USER_CIRCLE_LAYER, USER_LABEL_LAYER];

// [minLng, minLat, maxLng, maxLat] — matches the pmtiles archive's own
// bounds (see pipeline/README.md), used for the initial map view.
const INDIA_BOUNDS: [number, number, number, number] = [68.958232, 8.002868, 97.019637, 34.811197];

const MOVE_DEBOUNCE_MS = 400;
const USER_OFFICES_LIMIT = 500;

interface ApiOfficePoint {
  id: string;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
  address: string | null;
}

export function MapHome() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MaplibreModule | null>(null);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const popupTokenRef = useRef(0);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<OfficeCategory>>(
    () => new Set(CATEGORY_LIST)
  );

  // ---------------------------------------------------------------------
  // Map init (once).
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    async function init() {
      const [maplibregl, { Protocol }] = await Promise.all([
        import("maplibre-gl"),
        import("pmtiles"),
      ]);
      if (cancelled || !containerRef.current) return;

      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      maplibreRef.current = maplibregl;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        bounds: INDIA_BOUNDS,
        fitBoundsOptions: { padding: 24 },
      });
      mapRef.current = map;

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled || !map) return;

        map.addSource(OSM_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${window.location.origin}/tiles/offices.pmtiles`,
        });
        map.addSource(USER_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        const circleColor = categoryColorExpression() as DataDrivenPropertyValueSpecification<string>;

        const officeCircleLayer: CircleLayerSpecification = {
          id: OSM_CIRCLE_LAYER,
          type: "circle",
          source: OSM_SOURCE_ID,
          "source-layer": OSM_SOURCE_LAYER,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 4, 16, 8],
            "circle-color": circleColor,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        };
        map.addLayer(officeCircleLayer);

        const officeLabelLayer: SymbolLayerSpecification = {
          id: OSM_LABEL_LAYER,
          type: "symbol",
          source: OSM_SOURCE_ID,
          "source-layer": OSM_SOURCE_LAYER,
          minzoom: 13,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#1f2937",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.2,
          },
        };
        map.addLayer(officeLabelLayer);

        const userCircleLayer: CircleLayerSpecification = {
          id: USER_CIRCLE_LAYER,
          type: "circle",
          source: USER_SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 5, 16, 9],
            "circle-color": circleColor,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#111827",
          },
        };
        map.addLayer(userCircleLayer);

        const userLabelLayer: SymbolLayerSpecification = {
          id: USER_LABEL_LAYER,
          type: "symbol",
          source: USER_SOURCE_ID,
          minzoom: 13,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#1f2937",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.2,
          },
        };
        map.addLayer(userLabelLayer);

        map.on("mouseenter", CLICKABLE_LAYERS, () => {
          map!.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", CLICKABLE_LAYERS, () => {
          map!.getCanvas().style.cursor = "";
        });
        map.on("click", CLICKABLE_LAYERS, (e) => handleFeatureClick(map!, e));

        setLoaded(true);
        void refreshUserOffices(map);
        focusFromQueryParams(map);
      });

      map.on("moveend", () => {
        if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
        moveDebounceRef.current = setTimeout(() => {
          const current = mapRef.current;
          if (current) void refreshUserOffices(current);
        }, MOVE_DEBOUNCE_MS);
      });
    }

    init();

    return () => {
      cancelled = true;
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init
  }, []);

  // ---------------------------------------------------------------------
  // Category filter -> layer filters.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const filterExpr = [
      "in",
      ["get", "category"],
      ["literal", Array.from(activeCategories)],
    ] as unknown as NonNullable<Parameters<MapLibreMap["setFilter"]>[1]>;
    for (const layerId of FILTERABLE_LAYERS) {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, filterExpr);
      }
    }
  }, [activeCategories, loaded]);

  async function refreshUserOffices(map: MapLibreMap) {
    const bounds = map.getBounds();
    const bbox = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ].join(",");

    try {
      const res = await fetch(`/api/offices?bbox=${encodeURIComponent(bbox)}`);
      if (!res.ok) return;
      const body: { offices: ApiOfficePoint[] } = await res.json();
      const source = map.getSource(USER_SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      source.setData({
        type: "FeatureCollection",
        features: body.offices.slice(0, USER_OFFICES_LIMIT).map((office) => ({
          type: "Feature",
          id: office.id,
          geometry: { type: "Point", coordinates: [office.lng, office.lat] },
          properties: {
            id: office.id,
            name: office.name,
            category: office.category,
            address: office.address,
          },
        })),
      });
    } catch {
      // Best-effort: a failed refresh just leaves the previous data in place.
    }
  }

  function buildPopupNode(
    name: string,
    category: OfficeCategory,
    officeId: string | null
  ): { node: HTMLDivElement; link: HTMLAnchorElement } {
    const node = document.createElement("div");
    node.className = "flex flex-col gap-1 min-w-44 max-w-64";

    const title = document.createElement("div");
    title.className = "font-semibold text-sm text-black";
    title.textContent = name || strings.map.categories[category];
    node.appendChild(title);

    const categoryLine = document.createElement("div");
    categoryLine.className = "text-xs font-medium";
    categoryLine.style.color = CATEGORY_COLORS[category];
    categoryLine.textContent = strings.map.categories[category];
    node.appendChild(categoryLine);

    const link = document.createElement("a");
    link.className = "text-xs underline mt-1 w-fit text-black";
    if (officeId) {
      link.href = `/office/${officeId}`;
      link.textContent = strings.map.viewOffice;
    } else {
      link.removeAttribute("href");
      link.textContent = strings.map.loadingOffice;
    }
    node.appendChild(link);

    return { node, link };
  }

  function openPopup(
    map: MapLibreMap,
    coords: [number, number],
    name: string,
    category: OfficeCategory,
    officeId: string | null
  ): { token: number; link: HTMLAnchorElement } {
    const maplibregl = maplibreRef.current;
    popupRef.current?.remove();
    const token = ++popupTokenRef.current;

    const { node, link } = buildPopupNode(name, category, officeId);

    if (maplibregl) {
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(coords)
        .setDOMContent(node)
        .addTo(map);
    }

    return { token, link };
  }

  async function resolveOsmUid(osmUid: number): Promise<string | null> {
    try {
      const res = await fetch(`/api/offices/lookup?osm_uid=${osmUid}`);
      if (!res.ok) return null;
      const body: { office: { id: string } } = await res.json();
      return body.office.id;
    } catch {
      return null;
    }
  }

  function handleFeatureClick(map: MapLibreMap, e: MapLayerMouseEvent) {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const coords = feature.geometry.coordinates.slice(0, 2) as [number, number];
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const category = ((props.category as string) ?? "other") as OfficeCategory;
    const name = (props.name as string) ?? "";

    if (typeof props.id === "string") {
      openPopup(map, coords, name, category, props.id);
      return;
    }

    const osmUid = Number(props.osm_uid);
    const { token, link } = openPopup(map, coords, name, category, null);
    if (!Number.isFinite(osmUid)) {
      link.textContent = strings.map.officeUnavailable;
      return;
    }
    resolveOsmUid(osmUid).then((officeId) => {
      if (popupTokenRef.current !== token) return; // superseded by a newer popup
      if (officeId) {
        link.href = `/office/${officeId}`;
        link.textContent = strings.map.viewOffice;
      } else {
        link.textContent = strings.map.officeUnavailable;
      }
    });
  }

  function focusFromQueryParams(map: MapLibreMap) {
    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const zoomParam = Number(params.get("zoom"));
    const name = params.get("name") ?? "";
    const category = (params.get("category") as OfficeCategory | null) ?? "other";
    const id = params.get("id");

    map.jumpTo({ center: [lng, lat], zoom: Number.isFinite(zoomParam) ? zoomParam : 15 });
    openPopup(map, [lng, lat], name, category, id);
  }

  function handleSearchSelect(result: OfficeSearchResult) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [result.lng, result.lat], zoom: 16 });
    openPopup(map, [result.lng, result.lat], result.name, result.category, result.id);
  }

  function toggleCategory(category: OfficeCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  return (
    <div className="relative w-full h-dvh overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-950 text-sm text-black/60 dark:text-white/60 z-30">
          {strings.map.loadingMap}
        </div>
      ) : null}

      <div className="absolute top-0 left-0 right-0 p-3 flex flex-col gap-2 z-10 pointer-events-none sm:flex-row sm:items-start sm:justify-between">
        <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row sm:items-center">
          <OfficeSearchBox onSelect={handleSearchSelect} />
          <CategoryFilterBar active={activeCategories} onToggle={toggleCategory} />
        </div>
        <Link
          href="/add-office"
          className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium shadow-sm hover:opacity-90 w-fit"
        >
          {strings.map.addMissingOffice}
        </Link>
      </div>
    </div>
  );
}
