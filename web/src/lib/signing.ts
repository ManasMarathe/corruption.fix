import crypto from "node:crypto";

/**
 * Ed25519 signing for chain checkpoints (`chain_checkpoints.signature`).
 *
 * `CHECKPOINT_SIGNING_KEY` (env) is a 32-byte hex "seed" — not a PKCS8/DER
 * key itself, so that the env var stays a plain hex64 string like the
 * app's other secrets (VAULT_ENCRYPTION_KEY etc.) rather than a multi-line
 * PEM. Node's `crypto` module has no direct "raw seed -> Ed25519
 * KeyObject" constructor, so `privateKeyFromSeed` below wraps the 32-byte
 * seed in the minimal PKCS8 DER envelope Ed25519 private keys use (RFC
 * 8410) and hands that to `createPrivateKey`. See
 * `scripts/generate-signing-key.mjs` for generating a fresh seed.
 */

const SEED_BYTES = 32;

// RFC 8410 PKCS8 wrapper for a raw Ed25519 private key ("seed"). This is a
// fixed 16-byte ASN.1 prefix (algorithm identifier + octet string headers)
// that never changes; only the 32 seed bytes appended after it vary. This
// is the standard, documented byte layout — not a made-up encoding.
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);

// RFC 8410 SPKI wrapper for a raw Ed25519 public key.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function assertSeed(seedHex: string): Buffer {
  const seed = Buffer.from(seedHex, "hex");
  if (seed.length !== SEED_BYTES) {
    throw new Error(
      `CHECKPOINT_SIGNING_KEY must decode to exactly ${SEED_BYTES} bytes (got ${seed.length})`
    );
  }
  return seed;
}

/** Builds a Node `KeyObject` private key from a raw 32-byte hex seed. */
export function privateKeyFromSeed(seedHex: string): crypto.KeyObject {
  const seed = assertSeed(seedHex);
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Derives the corresponding Ed25519 public `KeyObject` from the same seed. */
export function publicKeyFromSeed(seedHex: string): crypto.KeyObject {
  return crypto.createPublicKey(privateKeyFromSeed(seedHex));
}

/** Hex-encodes a public key as raw 32-byte SPKI-stripped Ed25519 bytes,
 * suitable for publishing (e.g. as `CHECKPOINT_PUBLIC_KEY` / on
 * `/transparency`) and for `verifyCheckpoint` below. */
export function publicKeyToHex(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(SPKI_ED25519_PREFIX.length).toString("hex");
}

function publicKeyFromHex(publicKeyHex: string): crypto.KeyObject {
  const raw = Buffer.from(publicKeyHex, "hex");
  const der = Buffer.concat([SPKI_ED25519_PREFIX, raw]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

/** Signs `payload` (a utf8 string) with the Ed25519 key derived from
 * `seedHex`. Returns the signature hex-encoded. Ed25519 (unlike RSA/ECDSA)
 * doesn't take a separate digest algorithm — `sign(null, ...)` is correct. */
export function signPayload(seedHex: string, payload: string): string {
  const key = privateKeyFromSeed(seedHex);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return signature.toString("hex");
}

/** Verifies a hex signature against `payload` using a hex-encoded raw
 * Ed25519 public key (as produced by `publicKeyToHex`). */
export function verifyPayload(
  publicKeyHex: string,
  payload: string,
  signatureHex: string
): boolean {
  const key = publicKeyFromHex(publicKeyHex);
  try {
    return crypto.verify(
      null,
      Buffer.from(payload, "utf8"),
      key,
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

/** Builds the checkpoint payload string that gets signed:
 * `${fromSeq}:${toSeq}:${headHash}`. Kept as a named helper so the exact
 * format is defined in one place and can't drift between signing (jobs.ts)
 * and verification (the transparency proof endpoint / page). */
export function checkpointPayload(
  fromSeq: number,
  toSeq: number,
  headHash: string
): string {
  return `${fromSeq}:${toSeq}:${headHash}`;
}
