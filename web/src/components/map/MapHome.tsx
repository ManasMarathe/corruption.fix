"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  CircleLayerSpecification,
  GeoJSONSource,
  IControl,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Marker as MapLibreMarker,
  Popup as MapLibrePopup,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { DataDrivenPropertyValueSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { OfficeCategory } from "@/db/schema";
import { CATEGORY_COLORS, categoryColorExpression } from "@/lib/categories";
import { haversineKm } from "@/lib/distance";
import { INDIA_BOUNDS, type BBox, type GeocodePlace } from "@/lib/geocode";
import { defaultMapFilters, type MapFilters } from "@/lib/map-filters";
import {
  mapStateToSearch,
  parseMapFilters,
  parseMapFocus,
  parseMapView,
  type MapFocus,
} from "@/lib/map-url";
import {
  readSavedLocation,
  savedLocationFromPlace,
  skippedLocation,
  writeSavedLocation,
  type SavedLocation,
} from "@/lib/saved-location";
import { strings } from "@/lib/strings";
import { MapFilterPanel } from "./MapFilterPanel";
import { LocationChip } from "./LocationChip";
import { LocationPrompt } from "./LocationPrompt";
import { OfficeListPanel, type VisibleOffice } from "./OfficeListPanel";
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

// Zoom below which no office renders at all. ~180k pins at country zoom is
// an unreadable blur, so the map stays clean and tells the user to zoom in.
const OFFICE_MIN_ZOOM = 8;

const MOVE_DEBOUNCE_MS = 400;
const USER_OFFICES_LIMIT = 500;

// Rows the viewport list shows. A dense city view can render a few thousand
// pins; past ~50 the list stops being a list and the header says so.
const VISIBLE_LIST_LIMIT = 50;

// A Nominatim *node* result (a village, a single building) has a
// near-degenerate bbox that would otherwise fit to street level. Belt-and-
// braces with expandTinyBbox in src/lib/geocode.ts.
const FIT_BOUNDS_OPTIONS = { padding: 24, maxZoom: 14 } as const;

/**
 * "Back to my area" control, matching maplibre's own control markup
 * (`.maplibregl-ctrl.maplibregl-ctrl-group`) so it's visually part of the
 * bottom-right stack rather than a bolted-on button.
 *
 * It reads the target bbox from a ref rather than being handed one at
 * construction time: the control is added once, but the saved area can
 * change afterwards (LocationPrompt), and a ref lets the same control
 * instance pick up the new bbox without the map needing to be rebuilt or
 * the control re-added.
 */
class BackToAreaControl implements IControl {
  private readonly bboxRef: { current: BBox | null };
  private readonly onNavigate: () => void;

  constructor(bboxRef: { current: BBox | null }, onNavigate: () => void) {
    this.bboxRef = bboxRef;
    this.onNavigate = onNavigate;
  }

  onAdd(map: MapLibreMap): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    const button = document.createElement("button");
    button.type = "button";
    button.title = strings.map.controls.backToArea;
    button.setAttribute("aria-label", strings.map.controls.backToArea);
    button.textContent = "⌂"; // house glyph — simple, no icon font/SVG needed
    button.addEventListener("click", () => {
      const bbox = this.bboxRef.current;
      if (!bbox) return;
      // Checkpoint first: this is a discrete jump, so the browser's back
      // button should return to wherever the user was looking.
      this.onNavigate();
      map.fitBounds(bbox, FIT_BOUNDS_OPTIONS);
    });

    container.appendChild(button);
    return container;
  }

  onRemove(): void {
    // Nothing to tear down beyond the DOM node maplibre itself removes —
    // no listeners were attached outside `container`.
  }
}

/**
 * Overrides the English on maplibre's own control buttons so the map speaks
 * the same words as the rest of the chrome, and so the keyboard shortcuts
 * are discoverable from the buttons themselves. The strings existed in
 * `strings.map.controls` but nothing applied them until now.
 *
 * Fullscreen relabels itself when toggled, so this is a first-paint
 * improvement there rather than a permanent one — worth it for the other
 * four, which never change.
 */
function applyControlLabels(container: HTMLElement): void {
  const labels: Array<[string, string]> = [
    [".maplibregl-ctrl-zoom-in", strings.map.controls.zoomIn],
    [".maplibregl-ctrl-zoom-out", strings.map.controls.zoomOut],
    [".maplibregl-ctrl-compass", strings.map.controls.resetNorth],
    [".maplibregl-ctrl-geolocate", strings.map.controls.geolocate],
    [".maplibregl-ctrl-fullscreen", strings.map.controls.fullscreen],
  ];
  for (const [selector, label] of labels) {
    const button = container.querySelector<HTMLElement>(selector);
    if (!button) continue;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

/**
 * Composes every filter dimension (category, service, "has reports",
 * approximate-location inclusion) into one `["all", ...]` expression, plus
 * two zoom-based declutter rules, applied to every layer in
 * FILTERABLE_LAYERS.
 *
 * The declutter rules use `["step", ["zoom"], ...]` rather than a static
 * per-layer `minzoom` or splitting each layer per category: the pmtiles
 * import takes this map from ~25k to ~180k offices, dominated by post
 * offices, so post offices alone need a higher zoom floor than every other
 * category — and approximate (pincode-centroid) points need a *further*,
 * independent floor on top of that. A `step` expression folds both rules
 * into the one filter each layer already has, instead of forking every
 * layer (and CLICKABLE_LAYERS' hover/click bindings) into per-category and
 * per-precision copies.
 */
function buildFilterExpression(filters: MapFilters): unknown[] {
  const parts: unknown[] = [
    ["in", ["get", "category"], ["literal", Array.from(filters.categories)]],
  ];

  if (filters.services.size > 0) {
    // Tile features carry `services` as a comma-joined string (owned by the
    // tile build, not this component). Pad with a leading/trailing comma
    // and search for `,service,` rather than a bare substring match, so
    // e.g. filtering on "fir" can't accidentally match inside some other
    // service token. `coalesce` defensively treats a feature with no
    // `services` property as having none, rather than erroring.
    const paddedServices = [
      "concat",
      ",",
      ["to-string", ["coalesce", ["get", "services"], ""]],
      ",",
    ];
    parts.push([
      "any",
      ...Array.from(filters.services).map((service) => [
        ">=",
        ["index-of", `,${service},`, paddedServices],
        0,
      ]),
    ]);
  }

  if (filters.withReportsOnly) {
    // Defensive: a feature with no `has_reports` property coalesces to
    // false and is excluded, rather than erroring.
    parts.push(["==", ["coalesce", ["get", "has_reports"], false], true]);
  }

  // Features with no `precision` property are exact locations and must
  // pass either way — coalesce to "exact" so an absent property never
  // matches "approximate".
  const isApproximate = ["==", ["coalesce", ["get", "precision"], "exact"], "approximate"];

  if (!filters.includeApproximate) {
    parts.push(["!", isApproximate]);
  }

  // Category declutter: nothing below OFFICE_MIN_ZOOM; from there everything
  // except post offices; from z11 post offices join in too. The floor leaves
  // the default all-India view empty by design, so MapHome pairs it with a
  // "zoom in to see offices" hint — see `belowOfficeZoom`.
  parts.push([
    "step",
    ["zoom"],
    false,
    OFFICE_MIN_ZOOM,
    ["!=", ["get", "category"], "post_office"],
    11,
    true,
  ]);

  // Approximate-location declutter: those points only render from z13,
  // regardless of the category rule above — exact-location points are
  // untouched by this rule (it only ever narrows approximate ones further).
  parts.push(["step", ["zoom"], ["!", isApproximate], 13, true]);

  return ["all", ...parts];
}

interface ApiOfficePoint {
  id: string;
  name: string;
  category: OfficeCategory;
  lng: number;
  lat: number;
  address: string | null;
}

/** The ring that marks the row the pointer is over in the results list. */
function buildHighlightElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "26px";
  element.style.height = "26px";
  element.style.borderRadius = "9999px";
  element.style.border = "3px solid #111827";
  element.style.boxShadow = "0 0 0 3px rgba(255,255,255,0.9)";
  element.style.pointerEvents = "none";
  return element;
}

export function MapHome() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MaplibreModule | null>(null);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const popupTokenRef = useRef(0);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightMarkerRef = useRef<MapLibreMarker | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Read by BackToAreaControl's click handler; kept current by the "back to
  // area" effect below rather than by rebuilding the control on every
  // savedLocation change.
  const backToAreaBboxRef = useRef<BBox | null>(null);
  const backToAreaControlRef = useRef<BackToAreaControl | null>(null);

  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<MapFilters>(defaultMapFilters);
  // Drives the "zoom in to see offices" hint. buildFilterExpression hides
  // every office below OFFICE_MIN_ZOOM, and the default all-India view sits
  // well below it — without the hint that reads as a broken map rather than
  // a deliberate declutter.
  const [belowOfficeZoom, setBelowOfficeZoom] = useState(false);
  // Deliberately NOT a lazy useState initializer reading localStorage: this
  // component is server-rendered (app/page.tsx imports it directly, not via
  // dynamic({ ssr: false })), so the server would render "no saved area" and
  // the client "Pune", mismatching on the chip label. Populated in the
  // effect below instead.
  const [savedLocation, setSavedLocation] = useState<SavedLocation | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const [listOpen, setListOpen] = useState(false);
  const [visibleOffices, setVisibleOffices] = useState<VisibleOffice[]>([]);
  const [listTruncated, setListTruncated] = useState(false);
  const [listStale, setListStale] = useState(false);

  // Map event handlers are registered once, inside the init effect, so they
  // close over the first render's state. Everything they need to read that
  // can change afterwards goes through a ref instead.
  const filtersRef = useRef(filters);
  const loadedRef = useRef(false);
  const listOpenRef = useRef(false);
  const focusRef = useRef<MapFocus | null>(null);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  useEffect(() => {
    listOpenRef.current = listOpen;
  }, [listOpen]);

  // ---------------------------------------------------------------------
  // URL <-> view. `replaceState` for pans and filter changes (a hundred
  // history entries per drag would bury the back button), `pushState` only
  // for discrete jumps — search, place, "back to my area".
  // ---------------------------------------------------------------------
  const writeUrl = useCallback(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const center = map.getCenter();
    const search = mapStateToSearch(
      { lng: center.lng, lat: center.lat, zoom: map.getZoom() },
      filtersRef.current,
      focusRef.current
    );
    // Skipping an identical write keeps `replaceState` off the hot path of
    // every settled gesture.
    if (search === window.location.search) return;
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }, []);

  /**
   * Duplicates the current entry before a discrete jump, so the entry left
   * behind holds where the user *was* and the new one gets overwritten by
   * the `moveend` that follows. That avoids having to predict the
   * destination's zoom, which `fitBounds` decides for itself.
   */
  const pushHistoryCheckpoint = useCallback(() => {
    if (!loadedRef.current) return;
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  // ---------------------------------------------------------------------
  // Viewport list. Sourced from what maplibre has actually drawn rather
  // than from /api/offices?bbox= — that route returns only user-added
  // offices, while the ~180k imported ones live in the pmtiles source.
  // queryRenderedFeatures sees both, already filtered and zoom-gated.
  // ---------------------------------------------------------------------
  const collectVisibleOffices = useCallback((map: MapLibreMap): VisibleOffice[] => {
    const layers = CLICKABLE_LAYERS.filter((id) => map.getLayer(id));
    if (layers.length === 0) return [];

    const center = map.getCenter();
    const byKey = new Map<string, VisibleOffice>();

    for (const feature of map.queryRenderedFeatures({ layers })) {
      if (feature.geometry.type !== "Point") continue;
      const props = (feature.properties ?? {}) as Record<string, unknown>;

      const id = typeof props.id === "string" ? props.id : null;
      const osmUidRaw = Number(props.osm_uid);
      const osmUid = Number.isFinite(osmUidRaw) ? osmUidRaw : null;
      // A pin the tiles cut across two tiles comes back twice; and one with
      // neither identifier can't be opened, so it has no place in the list.
      const key = id ? `office:${id}` : osmUid !== null ? `osm:${osmUid}` : null;
      if (!key || byKey.has(key)) continue;

      const [lng, lat] = feature.geometry.coordinates as [number, number];
      byKey.set(key, {
        key,
        id,
        osmUid,
        name: typeof props.name === "string" ? props.name : "",
        category: ((props.category as string) ?? "other") as OfficeCategory,
        lng,
        lat,
        distanceKm: haversineKm([center.lng, center.lat], [lng, lat]),
      });
    }

    return [...byKey.values()].sort((a, b) => a.distanceKm - b.distanceKm);
  }, []);

  const rebuildList = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = (all: VisibleOffice[]) => {
      setVisibleOffices(all.slice(0, VISIBLE_LIST_LIMIT));
      setListTruncated(all.length > VISIBLE_LIST_LIMIT);
      setListStale(false);
    };

    const all = collectVisibleOffices(map);
    apply(all);
    // Opening the panel mid-tile-load queries a map that hasn't drawn
    // anything yet; retry once when it settles rather than showing a
    // permanent "no offices in this view".
    if (all.length === 0 && !map.isStyleLoaded()) {
      map.once("idle", () => {
        if (listOpenRef.current) apply(collectVisibleOffices(map));
      });
    }
  }, [collectVisibleOffices]);

  // ---------------------------------------------------------------------
  // Map init (once).
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    async function init() {
      // Read before the dynamic imports: this runs client-side after mount,
      // so localStorage is available and the saved bbox can go straight into
      // the constructor. That's what avoids a flash of the India view (and a
      // wasted fitBounds animation) on every return visit.
      //
      // Precedence is ?lat&lng > saved area > India. The URL view would win
      // visually anyway, but short-circuiting here avoids fitting to a bbox
      // we're about to discard.
      const urlView = parseMapView(new URLSearchParams(window.location.search));
      const saved = urlView ? null : readSavedLocation();

      const [maplibregl, { Protocol }] = await Promise.all([
        import("maplibre-gl"),
        import("pmtiles"),
      ]);
      if (cancelled || !containerRef.current) return;

      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);
      maplibreRef.current = maplibregl;

      // attributionControl: false + adding AttributionControl explicitly
      // below is what lets it move to bottom-left, freeing bottom-right for
      // the geolocate/fullscreen/navigation/back-to-area stack.
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        bounds: saved?.kind === "place" ? saved.bbox : INDIA_BOUNDS,
        fitBoundsOptions: FIT_BOUNDS_OPTIONS,
        attributionControl: false,
      });
      mapRef.current = map;
      backToAreaBboxRef.current = saved?.kind === "place" ? saved.bbox : null;

      // Bottom-right, in stacking order (maplibre stacks top-to-bottom in
      // the order controls are added): fullscreen, geolocate, navigation
      // (compass now enabled so a rotated map can be reset to north), then
      // "back to my area" — added separately below once there's somewhere
      // to go back to.
      map.addControl(new maplibregl.FullscreenControl(), "bottom-right");
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
        }),
        "bottom-right"
      );
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");

      // Bottom-left: scale, then the attribution control freed up by
      // `attributionControl: false` above.
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

      applyControlLabels(containerRef.current);

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

        // Approximate (pincode-centroid) offices render as a hollow ring —
        // opacity 0 fill, visible stroke in the category color instead of
        // the usual white — rather than a filled dot, so "we don't know
        // exactly where this is" is legible rather than implied precision
        // we don't have. `coalesce` means a feature with no `precision`
        // property (the common case) is simply treated as exact.
        const isApproximate = ["==", ["coalesce", ["get", "precision"], "exact"], "approximate"];
        const circleOpacity = [
          "case",
          isApproximate,
          0,
          1,
        ] as unknown as DataDrivenPropertyValueSpecification<number>;
        const circleStrokeWidth = [
          "case",
          isApproximate,
          2,
          1,
        ] as unknown as DataDrivenPropertyValueSpecification<number>;
        const circleStrokeColor = [
          "case",
          isApproximate,
          circleColor,
          "#ffffff",
        ] as unknown as DataDrivenPropertyValueSpecification<string>;
        // User-added offices keep their own (darker) default stroke color
        // when not approximate — their width was already 2 either way, so
        // only the color needs a `case`.
        const userCircleStrokeColor = [
          "case",
          isApproximate,
          circleColor,
          "#111827",
        ] as unknown as DataDrivenPropertyValueSpecification<string>;

        const officeCircleLayer: CircleLayerSpecification = {
          id: OSM_CIRCLE_LAYER,
          type: "circle",
          source: OSM_SOURCE_ID,
          "source-layer": OSM_SOURCE_LAYER,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 4, 16, 8],
            "circle-color": circleColor,
            "circle-opacity": circleOpacity,
            "circle-stroke-width": circleStrokeWidth,
            "circle-stroke-color": circleStrokeColor,
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
            "circle-opacity": circleOpacity,
            // User-added offices are always pinned precisely today, so this
            // never actually renders as a ring — kept for consistency in
            // case that ever changes.
            "circle-stroke-width": 2,
            "circle-stroke-color": userCircleStrokeColor,
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
        loadedRef.current = true;
        void refreshUserOffices(map);
        applyUrlState(map);
        // Stamp the resolved view so the address bar is shareable from the
        // first paint — but NOT on a true first visit, where the location
        // prompt is on screen. Writing there would put a view in the URL
        // that `parseMapView` then reads back on reload as a deep link,
        // suppressing the prompt the visitor never actually answered. Their
        // first real interaction stamps it instead.
        if (urlView || saved) writeUrl();
      });

      map.on("moveend", () => {
        if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
        moveDebounceRef.current = setTimeout(() => {
          const current = mapRef.current;
          if (!current) return;
          void refreshUserOffices(current);
          writeUrl();
          // Google-Maps behaviour: panning offers to re-run the search
          // rather than silently rewriting the list under the pointer.
          if (listOpenRef.current) setListStale(true);
        }, MOVE_DEBOUNCE_MS);
      });

      // Undebounced, unlike the office refetch: the hint explains why the
      // map looks empty, so it has to track the zoom immediately rather than
      // lagging 400ms behind the gesture that emptied it.
      const syncZoomHint = () => setBelowOfficeZoom(map!.getZoom() < OFFICE_MIN_ZOOM);
      syncZoomHint();
      map.on("zoom", syncZoomHint);
    }

    init();

    return () => {
      cancelled = true;
      loadedRef.current = false;
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      popupRef.current?.remove();
      highlightMarkerRef.current?.remove();
      highlightMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
      backToAreaControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init
  }, []);

  // ---------------------------------------------------------------------
  // Saved area + URL filters (once, after mount). The init effect reads
  // storage too; two reads is intentional and cheap — both run once and see
  // the same data, and it keeps the constructor's bounds independent of
  // React state. Filters come from the URL here rather than from a lazy
  // useState initializer for the same SSR reason as savedLocation.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters(parseMapFilters(params));

    const saved = readSavedLocation();
    setSavedLocation(saved);
    // Nothing stored and no deep link — this is a first visit, so ask.
    if (!saved && !parseMapView(params)) setPromptOpen(true);
  }, []);

  // ---------------------------------------------------------------------
  // Back/forward. The router never changes — only the query string — so
  // this re-applies the popped view, filters and pin in place.
  // ---------------------------------------------------------------------
  useEffect(() => {
    function handlePopState() {
      const map = mapRef.current;
      if (!map) return;

      const params = new URLSearchParams(window.location.search);
      setFilters(parseMapFilters(params));

      popupRef.current?.remove();
      const view = parseMapView(params);
      if (view) map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });

      const focus = parseMapFocus(params);
      if (focus && view) {
        openPopup(map, [view.lng, view.lat], focus.name, focus.category, focus.id);
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, []);

  // ---------------------------------------------------------------------
  // Keyboard shortcuts. Skipped while the user is typing, and while a modal
  // owns Escape — LocationPrompt and MapFilterPanel each handle their own.
  // ---------------------------------------------------------------------
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      // Cmd/Ctrl+K works even from inside a field — it only ever refocuses
      // the search box, which is what the user asked for either way.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (promptOpen) return;

      const map = mapRef.current;
      if (!map) return;

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        map.zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        map.zoomOut();
      } else if (e.key === "Escape") {
        // Innermost thing first: the popup, then the list.
        if (popupRef.current) popupRef.current.remove();
        else if (listOpenRef.current) setListOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [promptOpen]);

  // ---------------------------------------------------------------------
  // Back to my area: keep the control's bbox ref current, and add/remove
  // the control itself as "somewhere to go back to" appears or disappears
  // (first load, LocationPrompt selection, or skip). `loaded` is a
  // dependency purely so this re-runs once `mapRef.current` is guaranteed
  // set — the async map init can still be in flight when savedLocation
  // first resolves.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const bbox = savedLocation?.kind === "place" ? savedLocation.bbox : null;
    backToAreaBboxRef.current = bbox;

    if (bbox && !backToAreaControlRef.current) {
      const control = new BackToAreaControl(backToAreaBboxRef, pushHistoryCheckpoint);
      backToAreaControlRef.current = control;
      map.addControl(control, "bottom-right");
    } else if (!bbox && backToAreaControlRef.current) {
      map.removeControl(backToAreaControlRef.current);
      backToAreaControlRef.current = null;
    }
  }, [savedLocation, loaded, pushHistoryCheckpoint]);

  // ---------------------------------------------------------------------
  // Filters (category/service/reports/approximate) -> layer filters, the
  // URL, and the viewport list, all of which are derived from them.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const filterExpr = buildFilterExpression(filters) as unknown as NonNullable<
      Parameters<MapLibreMap["setFilter"]>[1]
    >;
    for (const layerId of FILTERABLE_LAYERS) {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, filterExpr);
      }
    }
    writeUrl();
    // setFilter repaints asynchronously, so read the result once the map has
    // caught up rather than listing the pre-filter features.
    if (listOpenRef.current) map.once("idle", rebuildList);
  }, [filters, loaded, writeUrl, rebuildList]);

  // Build the list the moment the panel opens, not only on the next pan.
  useEffect(() => {
    if (listOpen && loaded) rebuildList();
  }, [listOpen, loaded, rebuildList]);

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

  /**
   * Also records the open pin in `focusRef` so the URL can carry it — that
   * is what makes a search result, or a clicked pin, a linkable thing
   * rather than just a view. Cleared on close, including maplibre's own
   * close button and the Escape shortcut.
   */
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

    focusRef.current = officeId ? { id: officeId, name, category } : null;

    if (maplibregl) {
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
        .setLngLat(coords)
        .setDOMContent(node)
        .addTo(map);
      popup.on("close", () => {
        if (popupRef.current !== popup) return; // already superseded
        popupRef.current = null;
        focusRef.current = null;
        writeUrl();
      });
      popupRef.current = popup;
    }

    writeUrl();
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

  /**
   * Opens a pin's popup, resolving the app's office id from `osm_uid` when
   * the feature came out of the tiles rather than the user-added source.
   * Shared by the map click handler and the results list.
   */
  function openOfficePopup(
    map: MapLibreMap,
    coords: [number, number],
    name: string,
    category: OfficeCategory,
    officeId: string | null,
    osmUid: number | null
  ) {
    if (officeId) {
      openPopup(map, coords, name, category, officeId);
      return;
    }

    const { token, link } = openPopup(map, coords, name, category, null);
    if (osmUid === null) {
      link.textContent = strings.map.officeUnavailable;
      return;
    }
    void resolveOsmUid(osmUid).then((resolvedId) => {
      if (popupTokenRef.current !== token) return; // superseded by a newer popup
      if (resolvedId) {
        link.href = `/office/${resolvedId}`;
        link.textContent = strings.map.viewOffice;
        // Only now is there something to put in the URL for this pin.
        focusRef.current = { id: resolvedId, name, category };
        writeUrl();
      } else {
        link.textContent = strings.map.officeUnavailable;
      }
    });
  }

  function handleFeatureClick(map: MapLibreMap, e: MapLayerMouseEvent) {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const coords = feature.geometry.coordinates.slice(0, 2) as [number, number];
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const category = ((props.category as string) ?? "other") as OfficeCategory;
    const name = (props.name as string) ?? "";
    const osmUidRaw = Number(props.osm_uid);

    openOfficePopup(
      map,
      coords,
      name,
      category,
      typeof props.id === "string" ? props.id : null,
      Number.isFinite(osmUidRaw) ? osmUidRaw : null
    );
  }

  /** Applies `?lat&lng&zoom` and, if present, reopens `?id`'s popup. */
  function applyUrlState(map: MapLibreMap) {
    const params = new URLSearchParams(window.location.search);
    const view = parseMapView(params);
    if (!view) return;

    map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom });

    const focus = parseMapFocus(params);
    if (focus) openPopup(map, [view.lng, view.lat], focus.name, focus.category, focus.id);
  }

  function handleSearchSelectOffice(result: OfficeSearchResult) {
    const map = mapRef.current;
    if (!map) return;
    pushHistoryCheckpoint();
    map.flyTo({ center: [result.lng, result.lat], zoom: 16 });
    openPopup(map, [result.lng, result.lat], result.name, result.category, result.id);
  }

  /**
   * Selecting a place from the search box does the same thing as choosing
   * one in the first-visit prompt: it becomes the saved area. That is what
   * makes "back to my area" and the location chip follow the search rather
   * than lagging a visit behind it.
   */
  function handleLocationSelect(place: GeocodePlace) {
    const location = savedLocationFromPlace(place);
    writeSavedLocation(location);
    setSavedLocation(location);
    setPromptOpen(false);
    pushHistoryCheckpoint();
    // fitBounds fires `moveend`, which the debounced handler above already
    // turns into a refreshUserOffices call for the new viewport — no extra
    // fetch wiring needed here.
    mapRef.current?.fitBounds(place.bbox, { ...FIT_BOUNDS_OPTIONS, duration: 800 });
  }

  function handleLocationSkip() {
    // Persisted rather than merely dismissed: "show all of India" is a
    // choice, and re-asking on every visit would be a nag. The location chip
    // is how they get back to the prompt.
    const location = skippedLocation();
    writeSavedLocation(location);
    setSavedLocation(location);
    setPromptOpen(false);
  }

  function handleListSelect(office: VisibleOffice) {
    const map = mapRef.current;
    if (!map) return;
    highlightOffice(null);
    pushHistoryCheckpoint();
    // Never zooms *out* — the row was picked off the current view, so
    // pulling back would lose the context it was chosen in.
    map.flyTo({ center: [office.lng, office.lat], zoom: Math.max(map.getZoom(), 15) });
    openOfficePopup(map, [office.lng, office.lat], office.name, office.category, office.id, office.osmUid);
  }

  function highlightOffice(office: VisibleOffice | null) {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl) return;

    if (!office) {
      highlightMarkerRef.current?.remove();
      highlightMarkerRef.current = null;
      return;
    }

    if (!highlightMarkerRef.current) {
      highlightMarkerRef.current = new maplibregl.Marker({ element: buildHighlightElement() });
    }
    highlightMarkerRef.current.setLngLat([office.lng, office.lat]).addTo(map);
  }

  const chromePillClass =
    "pointer-events-auto shrink-0 inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/20 bg-white/95 dark:bg-black/70 px-3 py-2 text-sm font-medium shadow-sm hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <div className="relative w-full h-dvh overflow-hidden">
      {/* w-full/h-full are load-bearing: maplibre-gl.css sets `.maplibregl-map
          { position: relative }`, and depending on CSS bundle order it can win
          over Tailwind's `.absolute`, collapsing an inset-0-sized container to
          height 0 (map never renders, "Loading map…" never clears). Explicit
          dimensions keep the container full-bleed under either position. */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {!loaded ? (
        // z-[5]: below the chrome bar (z-10) so search/filter/add-office
        // render and stay usable while the map is still loading.
        <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-950 text-sm text-black/60 dark:text-white/60 z-[5]">
          {strings.map.loadingMap}
        </div>
      ) : null}

      {loaded && belowOfficeZoom ? (
        // Centred rather than tucked in a corner: at this zoom the map has
        // no pins at all, so this is the only thing explaining the emptiness.
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none z-[6]">
          <p className="rounded-full bg-white/95 dark:bg-neutral-900/95 border border-black/10 dark:border-white/20 px-4 py-2 text-sm shadow-sm">
            {strings.map.zoomInForOffices}
          </p>
        </div>
      ) : null}

      <div className="absolute top-0 left-0 right-0 p-3 flex flex-col gap-2 z-10 pointer-events-none sm:flex-row sm:items-start sm:justify-between">
        <div className="pointer-events-auto flex flex-col gap-2 sm:flex-row sm:items-center">
          <LocationChip
            name={savedLocation?.kind === "place" ? savedLocation.name : null}
            onClick={() => setPromptOpen(true)}
          />
          <OfficeSearchBox
            inputRef={searchInputRef}
            onSelectOffice={handleSearchSelectOffice}
            onSelectPlace={handleLocationSelect}
          />
          <div className="flex items-center gap-2">
            <MapFilterPanel filters={filters} onChange={setFilters} />
            <button
              type="button"
              aria-pressed={listOpen}
              onClick={() => setListOpen((open) => !open)}
              className={chromePillClass}
            >
              {strings.map.list.open}
            </button>
          </div>
        </div>
        <Link
          href="/add-office"
          className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium shadow-sm hover:opacity-90 w-fit"
        >
          {strings.map.addMissingOffice}
        </Link>
      </div>

      <OfficeListPanel
        open={listOpen}
        offices={visibleOffices}
        belowMinZoom={belowOfficeZoom}
        truncated={listTruncated}
        staleArea={listStale}
        onSearchThisArea={rebuildList}
        onSelect={handleListSelect}
        onHighlight={highlightOffice}
        onClose={() => {
          highlightOffice(null);
          setListOpen(false);
        }}
      />

      {promptOpen ? (
        <LocationPrompt onSelect={handleLocationSelect} onSkip={handleLocationSkip} />
      ) : null}
    </div>
  );
}
