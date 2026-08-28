"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  CircleLayerSpecification,
  GeoJSONSource,
  IControl,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup as MapLibrePopup,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { DataDrivenPropertyValueSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { OfficeCategory } from "@/db/schema";
import { CATEGORY_COLORS, categoryColorExpression } from "@/lib/categories";
import { INDIA_BOUNDS, type BBox, type GeocodePlace } from "@/lib/geocode";
import {
  readSavedLocation,
  savedLocationFromPlace,
  skippedLocation,
  writeSavedLocation,
  type SavedLocation,
} from "@/lib/saved-location";
import { strings } from "@/lib/strings";
import { defaultMapFilters, MapFilterPanel, type MapFilters } from "./MapFilterPanel";
import { LocationChip } from "./LocationChip";
import { LocationPrompt } from "./LocationPrompt";
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

  constructor(bboxRef: { current: BBox | null }) {
    this.bboxRef = bboxRef;
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
      if (bbox) map.fitBounds(bbox, FIT_BOUNDS_OPTIONS);
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

export function MapHome() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MaplibreModule | null>(null);
  const popupRef = useRef<MapLibrePopup | null>(null);
  const popupTokenRef = useRef(0);
  const moveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // Precedence is ?lat&lng > saved area > India. focusFromQueryParams
      // would win visually anyway, but short-circuiting here avoids fitting
      // to a bbox we're about to discard.
      const saved = hasFocusQueryParams() ? null : readSavedLocation();

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
      if (moveDebounceRef.current) clearTimeout(moveDebounceRef.current);
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
      backToAreaControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init
  }, []);

  // ---------------------------------------------------------------------
  // Saved area (once, after mount). The init effect reads storage too; two
  // reads is intentional and cheap — both run once and see the same data,
  // and it keeps the constructor's bounds independent of React state.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const saved = readSavedLocation();
    setSavedLocation(saved);
    // Nothing stored and no deep link — this is a first visit, so ask.
    if (!saved && !hasFocusQueryParams()) setPromptOpen(true);
  }, []);

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
      const control = new BackToAreaControl(backToAreaBboxRef);
      backToAreaControlRef.current = control;
      map.addControl(control, "bottom-right");
    } else if (!bbox && backToAreaControlRef.current) {
      map.removeControl(backToAreaControlRef.current);
      backToAreaControlRef.current = null;
    }
  }, [savedLocation, loaded]);

  // ---------------------------------------------------------------------
  // Filters (category/service/reports/approximate) -> layer filters.
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
  }, [filters, loaded]);

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

  /**
   * Whether the URL is driving the initial view. Guards against absent
   * params before Number(): Number(null) is 0, not NaN, so a bare "/" would
   * otherwise jump to [0,0] at zoom 0 and open an empty popup over the Gulf
   * of Guinea.
   *
   * Shared by focusFromQueryParams and the saved-area logic so "the URL
   * wins" is stated once rather than emerging from two separate checks.
   */
  function hasFocusQueryParams(): boolean {
    const params = new URLSearchParams(window.location.search);
    const latRaw = params.get("lat");
    const lngRaw = params.get("lng");
    if (latRaw === null || lngRaw === null) return false;
    return Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lngRaw));
  }

  function focusFromQueryParams(map: MapLibreMap) {
    if (!hasFocusQueryParams()) return;

    const params = new URLSearchParams(window.location.search);
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));

    const zoomRaw = params.get("zoom");
    const zoomParam = zoomRaw === null ? NaN : Number(zoomRaw);
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

  function handleLocationSelect(place: GeocodePlace) {
    const location = savedLocationFromPlace(place);
    writeSavedLocation(location);
    setSavedLocation(location);
    setPromptOpen(false);
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
          <OfficeSearchBox onSelect={handleSearchSelect} />
          <MapFilterPanel filters={filters} onChange={setFilters} />
        </div>
        <Link
          href="/add-office"
          className="pointer-events-auto inline-flex items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium shadow-sm hover:opacity-90 w-fit"
        >
          {strings.map.addMissingOffice}
        </Link>
      </div>

      {promptOpen ? (
        <LocationPrompt onSelect={handleLocationSelect} onSkip={handleLocationSkip} />
      ) : null}
    </div>
  );
}
