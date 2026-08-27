import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  canonicalizeComplaint,
  computeEntryHash,
  verifyChainSlice,
  verifyChainSliceWithFields,
  type ChainComplaintFields,
} from "./chain";

function fields(overrides: Partial<ChainComplaintFields> = {}): ChainComplaintFields {
  return {
    id: "01a0403b-a71b-71d2-9dcf-8d99e892f368",
    officeId: "01a0403b-a71b-71d2-9dcf-91cdb2104ca1",
    serviceType: "passport renewal",
    bribeAmount: 500,
    designation: "clerk",
    narrative: "I was asked to pay an unofficial fee to have my file moved.",
    consentTier: "publish_anon",
    publicMonth: "2026-08",
    ...overrides,
  };
}

function buildChain(fieldsList: ChainComplaintFields[]) {
  let prevHash = GENESIS_HASH;
  const entries = fieldsList.map((f, i) => {
    const canonical = canonicalizeComplaint(f);
    const entryHash = computeEntryHash(prevHash, canonical);
    const entry = { seq: i + 1, prevHash, entryHash, fields: f };
    prevHash = entryHash;
    return entry;
  });
  return entries;
}

describe("GENESIS_HASH", () => {
  it("is 64 hex zeros", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
    expect(GENESIS_HASH).toHaveLength(64);
    expect(GENESIS_HASH).toMatch(/^0+$/);
  });
});

describe("canonicalizeComplaint", () => {
  it("is stable regardless of input key order", () => {
    const a = fields();
    const b = {
      publicMonth: a.publicMonth,
      narrative: a.narrative,
      id: a.id,
      officeId: a.officeId,
      consentTier: a.consentTier,
      designation: a.designation,
      bribeAmount: a.bribeAmount,
      serviceType: a.serviceType,
    };
    expect(canonicalizeComplaint(a)).toBe(canonicalizeComplaint(b));
  });

  it("produces valid JSON with sorted keys", () => {
    const json = canonicalizeComplaint(fields());
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it("normalizes undefined/optional fields to null consistently", () => {
    const a = canonicalizeComplaint(fields({ bribeAmount: null, designation: null }));
    const parsed = JSON.parse(a);
    expect(parsed.bribeAmount).toBeNull();
    expect(parsed.designation).toBeNull();
  });

  it("excludes reporterId/officerNamePrivate/status/exact createdAt (not part of the type)", () => {
    const json = canonicalizeComplaint(fields());
    expect(json).not.toContain("reporterId");
    expect(json).not.toContain("officerNamePrivate");
    expect(json).not.toContain("createdAt");
    expect(json).not.toContain("status");
  });

  it("differs when narrative changes (narrative IS committed to)", () => {
    const a = canonicalizeComplaint(fields({ narrative: "original text" }));
    const b = canonicalizeComplaint(fields({ narrative: "altered text" }));
    expect(a).not.toBe(b);
  });
});

describe("computeEntryHash", () => {
  it("is deterministic", () => {
    const canonical = canonicalizeComplaint(fields());
    expect(computeEntryHash(GENESIS_HASH, canonical)).toBe(
      computeEntryHash(GENESIS_HASH, canonical)
    );
  });

  it("returns a 64-char hex sha256 digest", () => {
    const hash = computeEntryHash(GENESIS_HASH, canonicalizeComplaint(fields()));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different prevHash", () => {
    const canonical = canonicalizeComplaint(fields());
    const a = computeEntryHash(GENESIS_HASH, canonical);
    const b = computeEntryHash("1".repeat(64), canonical);
    expect(a).not.toBe(b);
  });

  it("differs for different canonical payload", () => {
    const a = computeEntryHash(GENESIS_HASH, canonicalizeComplaint(fields({ bribeAmount: 100 })));
    const b = computeEntryHash(GENESIS_HASH, canonicalizeComplaint(fields({ bribeAmount: 200 })));
    expect(a).not.toBe(b);
  });
});

describe("verifyChainSlice / verifyChainSliceWithFields", () => {
  it("verifies a valid genesis-anchored chain of several entries", () => {
    const entries = buildChain([
      fields({ id: "id-1" }),
      fields({ id: "id-2", bribeAmount: 1000 }),
      fields({ id: "id-3", narrative: "a different story entirely" }),
    ]);
    expect(verifyChainSlice(entries, GENESIS_HASH)).toEqual({ ok: true });
    expect(verifyChainSliceWithFields(entries, GENESIS_HASH)).toEqual({ ok: true });
  });

  it("verifies a slice anchored at a non-genesis checkpoint hash", () => {
    const entries = buildChain([fields({ id: "id-1" }), fields({ id: "id-2" })]);
    const [first, second] = entries;
    expect(verifyChainSlice([second], first.entryHash)).toEqual({ ok: true });
  });

  it("detects a modified field (entry hash no longer matches recomputed hash)", () => {
    const entries = buildChain([fields({ id: "id-1" }), fields({ id: "id-2" })]);
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, fields: { ...e.fields, bribeAmount: 999999 } } : e
    );
    // verifyChainSlice alone (no field recomputation) doesn't catch this —
    // the stored hashes are still internally self-consistent.
    expect(verifyChainSlice(tampered, GENESIS_HASH)).toEqual({ ok: true });
    // verifyChainSliceWithFields recomputes from fields and catches it.
    const result = verifyChainSliceWithFields(tampered, GENESIS_HASH);
    expect(result).toEqual({ ok: false, atSeq: 2, reason: "entry_hash_mismatch" });
  });

  it("detects reordered entries (prevHash linkage breaks)", () => {
    const entries = buildChain([
      fields({ id: "id-1" }),
      fields({ id: "id-2" }),
      fields({ id: "id-3" }),
    ]);
    const reordered = [entries[0], entries[2], entries[1]];
    const result = verifyChainSlice(reordered, GENESIS_HASH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("prev_hash_mismatch");
    }
  });

  it("detects a removed (missing) link in the middle of the chain", () => {
    const entries = buildChain([
      fields({ id: "id-1" }),
      fields({ id: "id-2" }),
      fields({ id: "id-3" }),
    ]);
    const withGap = [entries[0], entries[2]]; // entries[1] silently dropped
    const result = verifyChainSlice(withGap, GENESIS_HASH);
    expect(result).toEqual({ ok: false, atSeq: 3, reason: "prev_hash_mismatch" });
  });

  it("detects a chain that doesn't start from the expected anchor", () => {
    const entries = buildChain([fields({ id: "id-1" })]);
    const result = verifyChainSlice(entries, "f".repeat(64));
    expect(result).toEqual({ ok: false, atSeq: 1, reason: "prev_hash_mismatch" });
  });

  it("empty slice trivially verifies", () => {
    expect(verifyChainSlice([], GENESIS_HASH)).toEqual({ ok: true });
  });
});
