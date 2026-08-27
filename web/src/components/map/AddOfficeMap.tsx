"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

const DEFAULT_CENTER: [number, number] = [78.9629, 22.5937]; // geographic center of India
const DEFAULT_ZOOM = 4.2;
const PIN_ZOOM = 15;

/**
 * Small click/drag-to-place-a-pin map for the add-office form. Deliberately
 * lighter than the home map: no pmtiles overlay, no popups — just a base
 * style and a single draggable marker reporting its position up to the
 * parent form.
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
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

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
