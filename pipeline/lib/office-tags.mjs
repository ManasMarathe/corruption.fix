// Shared OSM tag -> offices-row mapping, used by both 03-import.mjs (writes
// the DB) and lib/prepare-tiles-geojson.mjs (writes the vector tiles), so a
// tile feature's category/name always match what's in Postgres for the
// same osm_uid.
export const CATEGORY_LABELS = {
  police: "Police station",
  post_office: "Post office",
  court: "Court",
  govt_office: "Government office",
  rto: "RTO",
  // amenity=townhall / office=administrative — see categoryFor() below for
  // why these land in "other" rather than "govt_office".
  other: "Administrative office",
};

/** Feature -> {type: "node"|"way"|"relation", id: string} | null */
export function extractIdType(feature) {
  const props = feature.properties || {};
  if (props["@type"] && props["@id"] != null) {
    return { type: props["@type"], id: String(props["@id"]) };
  }
  if (typeof feature.id === "string") {
    let m = /^(node|way|relation)\/(\d+)$/.exec(feature.id);
    if (m) return { type: m[1], id: m[2] };
    m = /^([nwr])(\d+)$/.exec(feature.id);
    if (m) {
      const type = m[1] === "n" ? "node" : m[1] === "w" ? "way" : "relation";
      return { type, id: m[2] };
    }
  }
  return null;
}

// RTO-name detection regex, checked against tags.name AND the vernacular
// name:hi/name:mr fields. "RTO|Regional Transport" alone matched only ~164
// of India's ~1,400 real RTOs, because most are tagged only in Hindi/Marathi
// (OSM contributors overwhelmingly use the local script for these, not
// English). Added:
//   - "परिवहन" (Devanagari "transport") — covers "प्रादेशिक परिवहन कार्यालय"
//     (Regional Transport Office) and shorter local variants like
//     "परिवहन कार्यालय" that drop "प्रादेशिक".
//   - "आरटीओ" — the Devanagari transliteration of the "RTO" initialism
//     itself, which shows up almost as often as the full translated name.
const RTO_NAME_RE = /RTO|Regional Transport|परिवहन|आरटीओ/i;

/** True when `tags` carries a real place name (vs. relying on the "(unnamed)"
 * fallback in nameFor()). Exported so lib/prepare-tiles-geojson.mjs can bias
 * tippecanoe's dot-dropping to keep named features first — see 04-tiles.sh. */
export function hasName(tags) {
  const raw = tags.name || tags["name:en"];
  return Boolean(raw && raw.trim());
}

/** OSM tags -> one of offices.category, or null if nothing matches. */
export function categoryFor(tags) {
  if (tags.amenity === "police") return "police";
  if (tags.amenity === "post_office") return "post_office";
  if (tags.amenity === "courthouse") return "court";
  if (tags.office === "government") {
    const name = tags.name || "";
    const nameHi = tags["name:hi"] || "";
    const nameMr = tags["name:mr"] || "";
    if (RTO_NAME_RE.test(name) || RTO_NAME_RE.test(nameHi) || RTO_NAME_RE.test(nameMr)) {
      return "rto";
    }
    return "govt_office";
  }
  // amenity=townhall / office=administrative (added to the 02-extract.sh tag
  // filter alongside office=government) are municipal/administrative bodies
  // — nagar palika, panchayat offices, municipal corporation buildings —
  // rather than state/central government departments, so lumping them into
  // "govt_office" would blur a real distinction the map cares about. "other"
  // already exists end-to-end (DB check constraint, OFFICE_CATEGORIES,
  // CATEGORY_LIST, map legend/filter) but nothing ever produced it before
  // this — these two tags are the first (and, for now, only) source of it.
  if (tags.amenity === "townhall" || tags.office === "administrative") {
    return "other";
  }
  return null;
}

export function nameFor(tags, category) {
  const raw = tags.name || tags["name:en"];
  if (raw && raw.trim()) return raw.trim();
  const label = CATEGORY_LABELS[category] || "Office";
  return `${label} (unnamed)`;
}

export function addressFor(tags) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] || tags["addr:city"],
    tags["addr:district"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter((v) => v && String(v).trim());
  return parts.length ? parts.join(", ") : null;
}

// Handles Point / Polygon / MultiPolygon. Polygons are reduced to an
// area-weighted centroid of their outer ring(s) (holes ignored — fine for
// picking a representative point for a building).
export function centroidOfGeometry(geom) {
  if (!geom) return null;
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    return { lng, lat };
  }
  const polygons =
    geom.type === "Polygon"
      ? [geom.coordinates]
      : geom.type === "MultiPolygon"
        ? geom.coordinates
        : null;
  if (!polygons) return null;

  let cx = 0;
  let cy = 0;
  let totalArea = 0;
  for (const poly of polygons) {
    const ring = poly[0]; // outer ring
    if (!ring || ring.length < 3) continue;
    let area = 0;
    let rcx = 0;
    let rcy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      rcx += (x0 + x1) * cross;
      rcy += (y0 + y1) * cross;
    }
    area /= 2;
    if (area === 0) continue;
    rcx /= 6 * area;
    rcy /= 6 * area;
    cx += rcx * Math.abs(area);
    cy += rcy * Math.abs(area);
    totalArea += Math.abs(area);
  }
  if (totalArea === 0) {
    const ring = polygons[0][0];
    const n = ring.length - 1;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return { lng: sx / n, lat: sy / n };
  }
  return { lng: cx / totalArea, lat: cy / totalArea };
}
