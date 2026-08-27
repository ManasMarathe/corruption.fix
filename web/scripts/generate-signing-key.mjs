#!/usr/bin/env node
// Generates a fresh Ed25519 key pair for chain checkpoint signing and
// prints both halves as hex:
//
//   - the 32-byte private "seed" -> set as CHECKPOINT_SIGNING_KEY (secret,
//     server-side only, never commit it)
//   - the 32-byte raw public key -> set as CHECKPOINT_PUBLIC_KEY (safe to
//     publish; it's how anyone can independently verify checkpoint
//     signatures shown on /transparency without trusting this server)
//
// Usage:
//   node scripts/generate-signing-key.mjs
//
// See src/lib/signing.ts for the seed <-> KeyObject encoding this pairs
// with (a raw 32-byte seed wrapped in the minimal RFC 8410 PKCS8 envelope).

import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

// Node has no direct "export raw seed" for Ed25519 private keys — the seed
// is the last 32 bytes of the PKCS8 DER encoding (see the RFC 8410 layout
// documented in src/lib/signing.ts).
const pkcs8Der = privateKey.export({ format: "der", type: "pkcs8" });
const seedHex = pkcs8Der.subarray(-32).toString("hex");

const spkiDer = publicKey.export({ format: "der", type: "spki" });
const publicKeyHex = spkiDer.subarray(-32).toString("hex");

console.log("CHECKPOINT_SIGNING_KEY=" + seedHex);
console.log("CHECKPOINT_PUBLIC_KEY=" + publicKeyHex);
console.log();
console.log(
  "Set CHECKPOINT_SIGNING_KEY as a secret (never commit it). CHECKPOINT_PUBLIC_KEY " +
    "is safe to publish and is shown on /transparency for independent verification."
);
