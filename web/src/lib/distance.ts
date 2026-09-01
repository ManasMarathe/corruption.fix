/**
 * Great-circle distance, for ordering the map's results list by how far
 * each office is from the centre of the current view.
 *
 * Deliberately a plain haversine rather than a projected/turf calculation:
 * the list only needs a stable ordering and a rough label, and this keeps
 * the map bundle free of another geo dependency.
 */

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(
  [lngA, latA]: [number, number],
  [lngB, latB]: [number, number]
): number {
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Human label for a distance. Metres below 1 km (rounded to 10 m, since the
 * office coordinates themselves aren't better than that), one decimal up to
 * 10 km, whole kilometres beyond.
 */
export function formatDistanceKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
