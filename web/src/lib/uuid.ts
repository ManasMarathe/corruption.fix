import { v7 as uuidv7, validate as uuidValidate } from "uuid";

/**
 * Generates a UUIDv7 (time-ordered, monotonic-ish) identifier.
 *
 * UUIDv7 is used for all primary keys in this app instead of a
 * database-generated UUIDv4 so that IDs are k-sortable by creation time,
 * which keeps b-tree primary key indexes append-mostly and makes ID order
 * a reasonable proxy for creation order without a separate timestamp join.
 */
export function newId(): string {
  return uuidv7();
}

/** Re-exported for convenience so callers don't need a direct `uuid` import. */
export function isValidId(value: string): boolean {
  return uuidValidate(value);
}
