import { describe, expect, it } from "vitest";
import { OFFICE_CATEGORIES, OFFICE_SERVICES } from "@/db/schema";
import { CATEGORY_LIST, CATEGORY_COLORS } from "./categories";
import { SERVICE_LIST } from "./services";

/**
 * `categories.ts` and `services.ts` hand-mirror the enums in `db/schema.ts`
 * on purpose — importing the runtime arrays would pull drizzle-orm/pg-core
 * into the client bundle, and only the types are erasable.
 *
 * The cost of that duplication is silent drift: add a category to the schema,
 * forget the mirror, and it vanishes from the legend and the filter while
 * still existing in the database. These tests are what makes the duplication
 * safe, so the mirrors stay cheap and the drift stays impossible.
 */

describe("client enum mirrors match the schema", () => {
  it("CATEGORY_LIST covers OFFICE_CATEGORIES exactly", () => {
    expect([...CATEGORY_LIST].sort()).toEqual([...OFFICE_CATEGORIES].sort());
  });

  it("every category has a color", () => {
    for (const category of OFFICE_CATEGORIES) {
      expect(CATEGORY_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("SERVICE_LIST covers OFFICE_SERVICES exactly", () => {
    expect([...SERVICE_LIST].sort()).toEqual([...OFFICE_SERVICES].sort());
  });
});
