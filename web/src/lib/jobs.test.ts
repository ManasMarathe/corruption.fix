import { describe, expect, it } from "vitest";
import { checkJobAuth, isJobName, JOB_NAMES } from "./jobs";

// env.ts falls back to a fixed dev JOB_SECRET outside production when
// JOB_SECRET isn't set (see src/lib/env.ts) — vitest.setup.ts leaves it
// unset, matching local dev, so that fallback value is what's in effect
// here.
const DEV_FALLBACK_JOB_SECRET = "dev-job-secret-do-not-use-in-production";

describe("checkJobAuth", () => {
  it("accepts a correct Bearer token", () => {
    expect(checkJobAuth(`Bearer ${DEV_FALLBACK_JOB_SECRET}`)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(checkJobAuth(null)).toBe(false);
    expect(checkJobAuth(undefined)).toBe(false);
  });

  it("rejects an empty header", () => {
    expect(checkJobAuth("")).toBe(false);
  });

  it("rejects the wrong token", () => {
    expect(checkJobAuth("Bearer wrong-secret")).toBe(false);
  });

  it("rejects a header missing the Bearer scheme", () => {
    expect(checkJobAuth(DEV_FALLBACK_JOB_SECRET)).toBe(false);
  });

  it("rejects a different auth scheme", () => {
    expect(checkJobAuth(`Basic ${DEV_FALLBACK_JOB_SECRET}`)).toBe(false);
  });

  it("rejects a token that is a prefix or superset of the real secret", () => {
    expect(checkJobAuth(`Bearer ${DEV_FALLBACK_JOB_SECRET.slice(0, -1)}`)).toBe(false);
    expect(checkJobAuth(`Bearer ${DEV_FALLBACK_JOB_SECRET}x`)).toBe(false);
  });
});

describe("isJobName", () => {
  it("accepts every known job name", () => {
    for (const name of JOB_NAMES) {
      expect(isJobName(name)).toBe(true);
    }
  });

  it("rejects unknown job names", () => {
    expect(isJobName("not-a-real-job")).toBe(false);
    expect(isJobName("")).toBe(false);
  });
});
