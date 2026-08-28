"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  CircleLayerSpecification,
  Map as MapLibreMap,
  Marker as MapLibreMarker,
} from "maplibre-gl";

const DEFAULT_CENTER: [number, number] = [78.9629, 22.5937]; // geographic center of India
const DEFAULT_ZOOM = 4.2;
const PIN_ZOOM = 15;

const OFFICES_SOURCE_ID = "offices";
const OFFICES_SOURCE_LAYER = "offices";
const OFFICES_CIRCLE_LAYER = "offices-circle";
// Muted grey rather than CATEGORY_COLORS: these dots are read-only context
// for spotting a duplicate before placing a pin, not the subject of this
// map. Category colours would visually compete with the draggable marker,
// which must stay the dominant element.
const EXISTING_OFFICE_COLOR = "#9ca3af";

/**
 * Small click/drag-to-place-a-pin map for the add-office form. Lighter than
 * the home map — no search, no filters, no popups — but it does render the
 * existing-offices pmtiles layer (read-only: no popups, no click handling,
 * no cursor change) so a contributor can see whether the office is already
 * on the map before dropping a pin on top of it. The layer sits underneath
 * a single draggable marker that reports its position up to the parent
 * form; clicking/dragging always places the pin, never the read-only dots.
 */
export function AddOfficeMap({
  initialLat,
  initialLng,
  onChange,
}: {
  initialLat?: number;
  initialLng?: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let marker: MapLibreMarker | null = null;

    async function init() {
      const [maplibregl, { Protocol }] = await Promise.all([
        import("maplibre-gl"),
        import("pmtiles"),
      ]);
      if (cancelled || !containerRef.current) return;

      const protocol = new Protocol();
      maplibregl.addProtocol("pmtiles", protocol.tile);

      const hasInitial =
        typeof initialLat === "number" && typeof initialLng === "number";
      const center: [number, number] = hasInitial
        ? [initialLng as number, initialLat as number]
        : DEFAULT_CENTER;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center,
        zoom: hasInitial ? PIN_ZOOM : DEFAULT_ZOOM,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (cancelled || !map) return;

        map.addSource(OFFICES_SOURCE_ID, {
          type: "vector",
          url: `pmtiles://${window.location.origin}/tiles/offices.pmtiles`,
        });

        const officesCircleLayer: CircleLayerSpecification = {
          id: OFFICES_CIRCLE_LAYER,
          type: "circle",
          source: OFFICES_SOURCE_ID,
          "source-layer": OFFICES_SOURCE_LAYER,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 3, 16, 6],
            "circle-color": EXISTING_OFFICE_COLOR,
            "circle-opacity": 0.6,
          },
        };
        // No click/mouseenter handlers on this layer, unlike MapHome's — the
        // map's click behaviour here is "place the pin", and must not be
        // hijacked by the read-only context dots.
        map.addLayer(officesCircleLayer);
      });

      marker = new maplibregl.Marker({ draggable: true, color: "#111827" })
        .setLngLat(center)
        .addTo(map);

      if (hasInitial) {
        onChangeRef.current(initialLat as number, initialLng as number);
      }

      marker.on("dragend", () => {
        const lngLat = marker!.getLngLat();
        onChangeRef.current(lngLat.lat, lngLat.lng);
      });

      map.on("click", (e) => {
        marker!.setLngLat(e.lngLat);
        onChangeRef.current(e.lngLat.lat, e.lngLat.lng);
      });
    }

    init();

    return () => {
      cancelled = true;
      marker?.remove();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time init; initialLat/Lng only used for the first mount
  }, []);

  return <div ref={containerRef} className="w-full h-64 sm:h-80 rounded-lg overflow-hidden" />;
}
