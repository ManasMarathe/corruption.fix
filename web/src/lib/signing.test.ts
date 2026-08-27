import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkpointPayload,
  privateKeyFromSeed,
  publicKeyFromSeed,
  publicKeyToHex,
  signPayload,
  verifyPayload,
} from "./signing";

function randomSeedHex(): string {
  return crypto.randomBytes(32).toString("hex");
}

describe("privateKeyFromSeed / publicKeyFromSeed", () => {
  it("is deterministic: the same seed always yields the same public key", () => {
    const seed = randomSeedHex();
    const a = publicKeyToHex(publicKeyFromSeed(seed));
    const b = publicKeyToHex(publicKeyFromSeed(seed));
    expect(a).toBe(b);
  });

  it("different seeds yield different public keys", () => {
    const a = publicKeyToHex(publicKeyFromSeed(randomSeedHex()));
    const b = publicKeyToHex(publicKeyFromSeed(randomSeedHex()));
    expect(a).not.toBe(b);
  });

  it("throws on a malformed (wrong-length) seed", () => {
    expect(() => privateKeyFromSeed("abcd")).toThrow();
  });

  it("public key hex round-trips through Node's native key generation", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const seed = privateKey
      .export({ format: "der", type: "pkcs8" })
      .subarray(-32)
      .toString("hex");
    const derived = publicKeyToHex(publicKeyFromSeed(seed));
    const expected = publicKeyToHex(publicKey);
    expect(derived).toBe(expected);
  });
});

describe("signPayload / verifyPayload", () => {
  it("round-trips: a signature from signPayload verifies with the matching public key", () => {
    const seed = randomSeedHex();
    const publicKeyHex = publicKeyToHex(publicKeyFromSeed(seed));
    const payload = checkpointPayload(1, 42, "a".repeat(64));

    const signature = signPayload(seed, payload);
    expect(verifyPayload(publicKeyHex, payload, signature)).toBe(true);
  });

  it("rejects a signature verified against a different payload", () => {
    const seed = randomSeedHex();
    const publicKeyHex = publicKeyToHex(publicKeyFromSeed(seed));
    const signature = signPayload(seed, checkpointPayload(1, 42, "a".repeat(64)));

    expect(verifyPayload(publicKeyHex, checkpointPayload(1, 43, "a".repeat(64)), signature)).toBe(
      false
    );
  });

  it("rejects a signature verified against the wrong public key", () => {
    const seedA = randomSeedHex();
    const seedB = randomSeedHex();
    const payload = checkpointPayload(1, 42, "a".repeat(64));
    const signature = signPayload(seedA, payload);
    const publicKeyHexB = publicKeyToHex(publicKeyFromSeed(seedB));

    expect(verifyPayload(publicKeyHexB, payload, signature)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const seed = randomSeedHex();
    const publicKeyHex = publicKeyToHex(publicKeyFromSeed(seed));
    const payload = checkpointPayload(1, 42, "a".repeat(64));
    const signature = signPayload(seed, payload);
    const tampered = (signature[0] === "0" ? "1" : "0") + signature.slice(1);

    expect(verifyPayload(publicKeyHex, payload, tampered)).toBe(false);
  });

  it("does not throw on garbage signature input, just returns false", () => {
    const publicKeyHex = publicKeyToHex(publicKeyFromSeed(randomSeedHex()));
    expect(verifyPayload(publicKeyHex, "payload", "not-hex")).toBe(false);
    expect(verifyPayload(publicKeyHex, "payload", "")).toBe(false);
  });
});

describe("checkpointPayload", () => {
  it("formats as fromSeq:toSeq:headHash", () => {
    expect(checkpointPayload(1, 10, "deadbeef")).toBe("1:10:deadbeef");
  });
});
