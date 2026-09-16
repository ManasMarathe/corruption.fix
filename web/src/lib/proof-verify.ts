/**
 * Browser-safe verification of a transparency proof (`/api/transparency/proof`).
 *
 * This is the independent half of the tamper-evidence story: it recomputes
 * hashes and checks the checkpoint signature using only Web Crypto, so a
 * reader's own browser confirms the record rather than taking this server's
 * word for it.
 *
 * It deliberately does NOT import `./chain` or `./signing`. Those use
 * `node:crypto`, which would drag a Node polyfill into the client bundle.
 * The duplication that creates is the exact hazard `proof-verify.test.ts`
 * exists to close: those tests assert this module's canonicalization, entry
 * hashing, and checkpoint payload are byte-identical to the server's, so the
 * two cannot drift apart silently.
 *
 * Every function here runs unchanged in Node 20+ and in the browser —
 * `globalThis.crypto.subtle` is present in both.
 */

/** Must stay lexicographically sorted and identical to CANONICAL_FIELD_ORDER
 * in `./chain`. Enforced by proof-verify.test.ts. */
const CANONICAL_FIELD_ORDER = [
  "bribeAmount",
  "consentTier",
  "designation",
  "id",
  "narrative",
  "officeId",
  "publicMonth",
  "serviceType",
] as const;

export interface CanonicalFields {
  id: string;
  officeId: string;
  serviceType: string;
  bribeAmount: number | null;
  designation: string | null;
  narrative: string;
  consentTier: string;
  publicMonth: string | null;
}

export function canonicalizeComplaint(fields: CanonicalFields): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_FIELD_ORDER) {
    ordered[key] = fields[key] ?? null;
  }
  return JSON.stringify(ordered);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns null for anything that isn't an even-length run of hex digits, so
 * a malformed signature or key from the wire can't throw mid-verification.
 *
 * Backed by an explicitly allocated ArrayBuffer so the result is
 * `Uint8Array<ArrayBuffer>`, not `Uint8Array<ArrayBufferLike>`. Web Crypto's
 * `BufferSource` excludes SharedArrayBuffer-backed views, and since
 * TypeScript 5.7 made Uint8Array generic over its buffer the bare
 * `new Uint8Array(n)` form no longer satisfies it.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/** Mirror of computeEntryHash in `./chain`: sha256(prevHash + canonical). */
export async function computeEntryHash(prevHash: string, canonical: string): Promise<string> {
  return sha256Hex(prevHash + canonical);
}

/** Mirror of checkpointPayload in `./signing`. */
export function checkpointPayload(
  fromSeq: number,
  toSeq: number,
  headHash: string
): string {
  return `${fromSeq}:${toSeq}:${headHash}`;
}

/**
 * "unsupported" is a third outcome on purpose, distinct from "invalid": a
 * browser without Ed25519 in Web Crypto, or a server publishing no public
 * key, means the signature could not be checked — which must never be
 * reported to the reader as a passing signature, nor as a forged one.
 */
export type SignatureResult = "valid" | "invalid" | "unsupported";

export async function verifyCheckpointSignature(
  publicKeyHex: string | null,
  payload: string,
  signatureHex: string
): Promise<SignatureResult> {
  if (!publicKeyHex) return "unsupported";

  const rawKey = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  if (!rawKey || !signature) return "invalid";

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", rawKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
  } catch {
    // Ed25519 missing from this browser's Web Crypto. Not a bad signature.
    return "unsupported";
  }

  try {
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      signature,
      new TextEncoder().encode(payload)
    );
    return ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

export interface ChainSliceEntry {
  seq: number;
  prevHash: string;
  entryHash: string;
}

export interface ProofCheckpoint {
  fromSeq: number;
  toSeq: number;
  headHash: string;
  signature: string;
  publicKey: string | null;
}

export interface ProofResponse {
  seq: number;
  entryHash: string;
  prevHash: string;
  consentTier: string;
  canonicalFields: CanonicalFields | null;
  nearestCheckpoint: ProofCheckpoint | null;
  chainSlice: ChainSliceEntry[];
}

export type ProofVerdict =
  | { ok: true; anchored: false }
  | { ok: true; anchored: true; signature: SignatureResult }
  | {
      ok: false;
      reason:
        | "entry_hash_mismatch"
        | "chain_link_broken"
        | "checkpoint_mismatch"
        | "checkpoint_signature_invalid";
    };

/**
 * Runs the full check, in the order that fails soonest and most specifically.
 *
 * A note on what "anchored: false" does and does not mean: it says no signed
 * checkpoint covers this entry yet, so the slice is the entry alone. That
 * still proves the entry's own hash matches its disclosed content — it does
 * NOT walk the chain back to genesis, because the proof response does not
 * carry those entries.
 */
export async function verifyProof(proof: ProofResponse): Promise<ProofVerdict> {
  // 1. When the entry's content was disclosed, its stored hash must be
  // exactly what that content hashes to.
  if (proof.canonicalFields) {
    const recomputed = await computeEntryHash(
      proof.prevHash,
      canonicalizeComplaint(proof.canonicalFields)
    );
    if (recomputed !== proof.entryHash) {
      return { ok: false, reason: "entry_hash_mismatch" };
    }
  }

  // 2. The slice must link up: each entry's prevHash is the previous
  // entry's entryHash.
  let expectedPrev = proof.prevHash;
  for (const link of proof.chainSlice) {
    if (link.prevHash !== expectedPrev) {
      return { ok: false, reason: "chain_link_broken" };
    }
    expectedPrev = link.entryHash;
  }

  const checkpoint = proof.nearestCheckpoint;
  if (!checkpoint) return { ok: true, anchored: false };

  // 3. The slice must terminate exactly at the checkpoint's head.
  if (expectedPrev !== checkpoint.headHash) {
    return { ok: false, reason: "checkpoint_mismatch" };
  }

  // 4. And that head must actually be signed by the published key —
  // otherwise "anchored to a signed checkpoint" means nothing, since anyone
  // able to rewrite the chain could equally write a checkpoint row for it.
  const signature = await verifyCheckpointSignature(
    checkpoint.publicKey,
    checkpointPayload(checkpoint.fromSeq, checkpoint.toSeq, checkpoint.headHash),
    checkpoint.signature
  );
  if (signature === "invalid") {
    return { ok: false, reason: "checkpoint_signature_invalid" };
  }

  return { ok: true, anchored: true, signature };
}
