import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  decrypt,
  encrypt,
  hashToken,
  hmacEmail,
  hmacSha256,
  normalizeEmail,
} from "./crypto";

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", () => {
    const plaintext = "reporter@example.com";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encrypt("same-input@example.com");
    const b = encrypt("same-input@example.com");
    expect(a).not.toBe(b);
  });

  it("output is iv:tag:ciphertext, each base64", () => {
    const parts = encrypt("hello").split(":");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("throws on tampered ciphertext", () => {
    const parts = encrypt("tamper me").split(":");
    const ciphertextBuf = Buffer.from(parts[2], "base64");
    ciphertextBuf[0] ^= 0xff;
    const tampered = [parts[0], parts[1], ciphertextBuf.toString("base64")].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const parts = encrypt("tamper me too").split(":");
    const tagBuf = Buffer.from(parts[1], "base64");
    tagBuf[0] ^= 0xff;
    const tampered = [parts[0], tagBuf.toString("base64"), parts[2]].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on malformed payload shape", () => {
    expect(() => decrypt("not-a-valid-payload")).toThrow();
    expect(() => decrypt("a:b")).toThrow();
    expect(() => decrypt("a:b:c:d")).toThrow();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Reporter@Example.COM  ")).toBe("reporter@example.com");
  });
});

describe("hmacEmail", () => {
  it("is stable for equivalent emails regardless of case/whitespace", () => {
    const a = hmacEmail("Reporter@Example.com");
    const b = hmacEmail("  reporter@example.com  ");
    expect(a).toBe(b);
  });

  it("differs for different emails", () => {
    expect(hmacEmail("a@example.com")).not.toBe(hmacEmail("b@example.com"));
  });

  it("matches hmacSha256 of the normalized email", () => {
    expect(hmacEmail("Foo@Bar.com")).toBe(hmacSha256(normalizeEmail("Foo@Bar.com")));
  });
});

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(constantTimeEqual("short", "a-much-longer-string")).toBe(false);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("some-token")).toBe(hashToken("some-token"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("returns a 64-character hex sha256 digest", () => {
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
