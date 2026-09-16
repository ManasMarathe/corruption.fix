import { describe, expect, it } from "vitest";
import { canonicalizeComplaint as serverCanonicalize, computeEntryHash as serverEntryHash, GENESIS_HASH } from "./chain";
import { checkpointPayload as serverCheckpointPayload, publicKeyToHex, publicKeyFromSeed, signPayload } from "./signing";
import {
  canonicalizeComplaint,
  checkpointPayload,
  computeEntryHash,
  verifyCheckpointSignature,
  verifyProof,
  type CanonicalFields,
  type ProofResponse,
} from "./proof-verify";

/**
 * proof-verify.ts reimplements three things the server also implements,
 * because it has to run in a browser and chain.ts/signing.ts use node:crypto.
 * The first block below is what stops those copies drifting: it asserts the
 * two implementations agree byte for byte. If someone adds a field to the
 * chain's canonical form and forgets this file, these fail — which is the
 * whole point, since silent drift would make every published proof fail to
 * verify in the reader's browser while looking fine on the server.
 */

const FIELDS: CanonicalFields = {
  id: "018f2e2a-0000-7000-8000-000000000001",
  officeId: "018f2e2a-0000-7000-8000-0000000000ff",
  serviceType: "passport renewal",
  bribeAmount: 2000,
  designation: "clerk",
  narrative: "I was asked for money to move my file forward and refused twice.",
  consentTier: "publish_anon",
  publicMonth: "2026-09",
};

// A fixed seed keeps this deterministic; it is a test value, not a secret.
const SEED = "11".repeat(32);

describe("client/server agreement", () => {
  it("canonicalizes identically to chain.ts", () => {
    expect(canonicalizeComplaint(FIELDS)).toBe(serverCanonicalize(FIELDS));
  });

  it("canonicalizes identically with every nullable field null", () => {
    const sparse: CanonicalFields = {
      ...FIELDS,
      bribeAmount: null,
      designation: null,
      publicMonth: null,
    };
    expect(canonicalizeComplaint(sparse)).toBe(serverCanonicalize(sparse));
  });

  it("computes the same entry hash as chain.ts", async () => {
    const canonical = canonicalizeComplaint(FIELDS);
    expect(await computeEntryHash(GENESIS_HASH, canonical)).toBe(
      serverEntryHash(GENESIS_HASH, canonical)
    );
  });

  it("builds the same checkpoint payload as signing.ts", () => {
    expect(checkpointPayload(1, 9, "abc")).toBe(serverCheckpointPayload(1, 9, "abc"));
  });
});

describe("verifyCheckpointSignature", () => {
  const publicKeyHex = publicKeyToHex(publicKeyFromSeed(SEED));
  const payload = checkpointPayload(1, 3, "f".repeat(64));

  it("accepts a signature made by the matching key", async () => {
    const sig = signPayload(SEED, payload);
    expect(await verifyCheckpointSignature(publicKeyHex, payload, sig)).toBe("valid");
  });

  it("rejects a signature over different content", async () => {
    const sig = signPayload(SEED, payload);
    const tampered = checkpointPayload(1, 3, "e".repeat(64));
    expect(await verifyCheckpointSignature(publicKeyHex, tampered, sig)).toBe("invalid");
  });

  it("rejects a signature from a different key", async () => {
    const otherKey = publicKeyToHex(publicKeyFromSeed("22".repeat(32)));
    const sig = signPayload(SEED, payload);
    expect(await verifyCheckpointSignature(otherKey, payload, sig)).toBe("invalid");
  });

  it("reports unsupported — not valid — when no public key is published", async () => {
    const sig = signPayload(SEED, payload);
    expect(await verifyCheckpointSignature(null, payload, sig)).toBe("unsupported");
  });

  it("treats malformed hex as invalid rather than throwing", async () => {
    expect(await verifyCheckpointSignature(publicKeyHex, payload, "zzzz")).toBe("invalid");
    expect(await verifyCheckpointSignature(publicKeyHex, payload, "abc")).toBe("invalid");
  });
});

/** Builds a genuine one-entry chain plus a correctly signed checkpoint. */
async function buildProof(): Promise<ProofResponse> {
  const canonical = canonicalizeComplaint(FIELDS);
  const entryHash = await computeEntryHash(GENESIS_HASH, canonical);
  const payload = checkpointPayload(1, 1, entryHash);
  return {
    seq: 1,
    entryHash,
    prevHash: GENESIS_HASH,
    consentTier: FIELDS.consentTier,
    canonicalFields: FIELDS,
    nearestCheckpoint: {
      fromSeq: 1,
      toSeq: 1,
      headHash: entryHash,
      signature: signPayload(SEED, payload),
      publicKey: publicKeyToHex(publicKeyFromSeed(SEED)),
    },
    chainSlice: [{ seq: 1, prevHash: GENESIS_HASH, entryHash }],
  };
}

describe("verifyProof", () => {
  it("passes a well-formed, correctly signed proof", async () => {
    expect(await verifyProof(await buildProof())).toEqual({
      ok: true,
      anchored: true,
      signature: "valid",
    });
  });

  it("catches a narrative edited after the fact", async () => {
    const proof = await buildProof();
    proof.canonicalFields = { ...FIELDS, narrative: "Something else entirely happened." };
    expect(await verifyProof(proof)).toEqual({ ok: false, reason: "entry_hash_mismatch" });
  });

  it("catches a broken link between entries", async () => {
    const proof = await buildProof();
    proof.chainSlice = [{ ...proof.chainSlice[0], prevHash: "a".repeat(64) }];
    expect(await verifyProof(proof)).toEqual({ ok: false, reason: "chain_link_broken" });
  });

  it("catches a slice that does not reach the checkpoint head", async () => {
    const proof = await buildProof();
    proof.nearestCheckpoint!.headHash = "b".repeat(64);
    expect(await verifyProof(proof)).toEqual({ ok: false, reason: "checkpoint_mismatch" });
  });

  it("catches a checkpoint whose signature does not hold", async () => {
    const proof = await buildProof();
    // The head still matches the chain, so only the signature check can
    // catch this — exactly the case the old client-side code never tested.
    proof.nearestCheckpoint!.signature = signPayload(SEED, "1:1:" + "c".repeat(64));
    expect(await verifyProof(proof)).toEqual({
      ok: false,
      reason: "checkpoint_signature_invalid",
    });
  });

  it("passes but flags unsupported when no public key is published", async () => {
    const proof = await buildProof();
    proof.nearestCheckpoint!.publicKey = null;
    expect(await verifyProof(proof)).toEqual({
      ok: true,
      anchored: true,
      signature: "unsupported",
    });
  });

  it("passes unanchored when no checkpoint covers the entry yet", async () => {
    const proof = await buildProof();
    proof.nearestCheckpoint = null;
    expect(await verifyProof(proof)).toEqual({ ok: true, anchored: false });
  });

  it("still checks linkage when content is withheld", async () => {
    const proof = await buildProof();
    proof.canonicalFields = null;
    expect(await verifyProof(proof)).toEqual({
      ok: true,
      anchored: true,
      signature: "valid",
    });
  });
});
