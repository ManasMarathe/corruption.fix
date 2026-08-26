import { customType } from "drizzle-orm/pg-core";

/** A WGS84 (SRID 4326) longitude/latitude pair. */
export type GeoPoint = {
  lng: number;
  lat: number;
};

/**
 * PostGIS `geometry(Point,4326)` column, mapped to/from a plain
 * `{ lng, lat }` object. Values round-trip through EWKT
 * (`SRID=4326;POINT(lng lat)`) on the way in; reads should select geometry
 * columns through `ST_AsText(...)` (or similar) so the driver receives WKT
 * rather than raw EWKB.
 *
 * The GiST index on this column (`offices_geom_gix`) is created via raw SQL
 * in the migration rather than through this column definition — see
 * web/drizzle/*.sql.
 */
export const geometryPoint = customType<{
  data: GeoPoint;
  driverData: string;
}>({
  dataType() {
    return "geometry(Point,4326)";
  },
  toDriver(value: GeoPoint): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value: string): GeoPoint {
    const match = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(value);
    if (!match) {
      throw new Error(`Unable to parse geometry value as WKT point: ${value}`);
    }
    return { lng: Number(match[1]), lat: Number(match[2]) };
  },
});
