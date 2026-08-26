import crypto from "node:crypto";
import { env } from "./env";

/**
 * Low-level crypto primitives backing the identity vault (see `./vault.ts`)
 * and session/OTP hashing (see `./session.ts`, `./otp.ts`).
 *
 * This module is pure and has no database dependency, so it's fully unit
 * testable without Postgres — see `crypto.test.ts`.
 */

const AES_ALGO = "aes-256-gcm";
const AES_IV_BYTES = 12;

function encryptionKey(): Buffer {
  return Buffer.from(env.VAULT_ENCRYPTION_KEY, "hex");
}

function hmacKey(): Buffer {
  return Buffer.from(env.VAULT_HMAC_KEY, "hex");
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `VAULT_ENCRYPTION_KEY`.
 *
 * Output format is `iv:tag:ciphertext`, each component independently
 * base64-encoded, so the stored string is self-describing and doesn't
 * require a fixed-offset byte layout to parse back apart.
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(AES_IV_BYTES);
  const cipher = crypto.createCipheriv(AES_ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext]
    .map((buf) => buf.toString("base64"))
    .join(":");
}

/**
 * Decrypts a payload produced by `encrypt`. Throws if the payload is
 * malformed or the GCM authentication tag doesn't verify (tampering,
 * truncation, or the wrong key).
 */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("malformed vault ciphertext: expected iv:tag:ciphertext");
  }
  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = crypto.createDecipheriv(AES_ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Trims and lowercases an email so the same address always hashes/matches
 * the same way regardless of how a user typed it. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Keyed HMAC-SHA256 over an arbitrary string, hex-encoded. */
export function hmacSha256(value: string): string {
  return crypto.createHmac("sha256", hmacKey()).update(value, "utf8").digest("hex");
}

/** HMAC-SHA256 of a normalized email — the lookup key stored as
 * `reporter_identities.email_hmac` / `otp_codes.email_hmac`. */
export function hmacEmail(email: string): string {
  return hmacSha256(normalizeEmail(email));
}

/**
 * Constant-time string comparison. Used for anything derived from a secret
 * (OTP code hashes, tokens) so an attacker can't use response-time
 * differences to guess a value byte-by-byte.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Do a same-cost comparison anyway so a length mismatch doesn't return
    // measurably faster than a same-length mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** SHA-256 hex digest — used to store session tokens and OTP codes at rest
 * so the raw secret never touches the database. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
