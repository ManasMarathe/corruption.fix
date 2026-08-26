// Shared OSM-id convention used by both 03-import.mjs (DB) and 04-tiles.sh
// (via the GeoJSON properties baked in during extraction) so a clicked
// tile feature's `osm_uid` can be joined straight to `offices.osm_id`.
//
// Raw OSM ids are only unique *within* a given element type (node / way /
// relation) — a node and a way can legitimately share the same numeric id.
// To get one globally-unique bigint we tag each id with an offset by type:
//
//   node:     id                (0                 .. ~9,999,999,999)
//   way:      id + 10_000_000_000        (1e10)
//   relation: id + 20_000_000_000        (2e10)
//
// 1e10 comfortably exceeds the current largest OSM node id (~1.2e10 is
// getting close for nodes as of 2024-2025, so this scheme has a shelf life
// but is far beyond anything in the India extract for the foreseeable
// future). The result fits well within Postgres bigint (int8, max ~9.2e18)
// and JS's safe integer range (2^53 - 1 ~= 9.007e15).
const TYPE_OFFSET = {
  node: 0n,
  way: 10_000_000_000n,
  relation: 20_000_000_000n,
};

/**
 * @param {"node"|"way"|"relation"} type
 * @param {number|string|bigint} id
 * @returns {number} a globally-unique OSM id, safe to store in a JS number
 *   (well under Number.MAX_SAFE_INTEGER) and in a Postgres bigint column.
 */
export function osmUid(type, id) {
  const offset = TYPE_OFFSET[type];
  if (offset === undefined) {
    throw new Error(`osmUid: unknown OSM element type ${type}`);
  }
  const uid = offset + BigInt(id);
  return Number(uid);
}

/**
 * osmium export emits GeoJSON Feature ids as strings like "n123", "w456",
 * "r789". Parse one of those directly into the same convention as osmUid().
 * @param {string} osmiumId
 * @returns {number}
 */
export function osmUidFromOsmiumId(osmiumId) {
  const m = /^([nwr])(\d+)$/.exec(String(osmiumId));
  if (!m) {
    throw new Error(`osmUidFromOsmiumId: unrecognized id format ${osmiumId}`);
  }
  const type = m[1] === "n" ? "node" : m[1] === "w" ? "way" : "relation";
  return osmUid(type, m[2]);
}
