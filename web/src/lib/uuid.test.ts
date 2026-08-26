import { describe, expect, it } from "vitest";
import { isValidId, newId } from "./uuid";

describe("uuid helper", () => {
  it("generates a valid, unique UUIDv7 each call", () => {
    const a = newId();
    const b = newId();

    expect(isValidId(a)).toBe(true);
    expect(isValidId(b)).toBe(true);
    expect(a).not.toBe(b);

    // Version nibble (13th hex digit) must be "7" for UUIDv7.
    expect(a[14]).toBe("7");
  });

  it("rejects non-UUID strings", () => {
    expect(isValidId("not-a-uuid")).toBe(false);
  });
});
