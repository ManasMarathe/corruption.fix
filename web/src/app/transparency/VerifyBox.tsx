"use client";

import { useState } from "react";
import { strings } from "@/lib/strings";

/**
 * Client-side recomputation of the hash chain, mirroring
 * src/lib/chain.ts's canonicalizeComplaint/computeEntryHash exactly (kept
 * in sync manually — see the comment below — since chain.ts uses
 * node:crypto, which isn't available in the browser; this uses Web
 * Crypto's SubtleCrypto instead).
 */
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

interface CanonicalFields {
  id: string;
  officeId: string;
  serviceType: string;
  bribeAmount: number | null;
  designation: string | null;
  narrative: string;
  consentTier: string;
  publicMonth: string | null;
}

function canonicalize(fields: CanonicalFields): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_FIELD_ORDER) {
    ordered[key] = (fields as unknown as Record<string, unknown>)[key] ?? null;
  }
  return JSON.stringify(ordered);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeEntryHash(prevHash: string, canonical: string): Promise<string> {
  return sha256Hex(prevHash + canonical);
}

interface ChainSliceEntry {
  seq: number;
  prevHash: string;
  entryHash: string;
}

interface ProofResponse {
  seq: number;
  entryHash: string;
  prevHash: string;
  consentTier: string;
  canonicalFields: CanonicalFields | null;
  nearestCheckpoint: { toSeq: number; headHash: string; signature: string } | null;
  chainSlice: ChainSliceEntry[];
}

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "pass"; anchored: boolean; proof: ProofResponse }
  | { kind: "fail"; reason: string; proof: ProofResponse };

async function verify(proof: ProofResponse): Promise<Result> {
  // 1. If this entry's own field content was disclosed, its hash must
  // recompute to exactly what's stored.
  if (proof.canonicalFields) {
    const recomputed = await computeEntryHash(proof.prevHash, canonicalize(proof.canonicalFields));
    if (recomputed !== proof.entryHash) {
      return { kind: "fail", reason: "entry_hash_mismatch", proof };
    }
  }

  // 2. The chain slice (this entry through its nearest checkpoint, or just
  // this entry if unanchored) must link up: each entry's prevHash must
  // equal the previous entry's entryHash.
  let expectedPrev = proof.prevHash;
  for (const link of proof.chainSlice) {
    if (link.prevHash !== expectedPrev) {
      return { kind: "fail", reason: "chain_link_broken", proof };
    }
    expectedPrev = link.entryHash;
  }

  // 3. If anchored to a signed checkpoint, the slice must terminate at
  // exactly that checkpoint's head hash.
  if (proof.nearestCheckpoint) {
    if (expectedPrev !== proof.nearestCheckpoint.headHash) {
      return { kind: "fail", reason: "checkpoint_mismatch", proof };
    }
    return { kind: "pass", anchored: true, proof };
  }

  return { kind: "pass", anchored: false, proof };
}

export function VerifyBox() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim();
    if (!id) return;

    setResult({ kind: "loading" });
    try {
      const res = await fetch(`/api/transparency/proof?complaint=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setResult({ kind: "not-found" });
        return;
      }
      if (!res.ok) {
        setResult({ kind: "error" });
        return;
      }
      const proof = (await res.json()) as ProofResponse;
      setResult(await verify(proof));
    } catch {
      setResult({ kind: "error" });
    }
  }

  return (
    <div className="border rounded-lg p-5 flex flex-col gap-3 border-black/15 dark:border-white/15">
      <h2 className="text-lg font-semibold">{strings.transparency.verify.heading}</h2>
      <p className="text-sm text-black/70 dark:text-white/70">{strings.transparency.verify.body}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={strings.transparency.verify.inputPlaceholder}
          aria-label={strings.transparency.verify.inputLabel}
          className="flex-1 border rounded px-3 py-2 bg-transparent text-sm"
        />
        <button
          type="submit"
          disabled={result.kind === "loading"}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {result.kind === "loading" ? strings.transparency.verify.verifying : strings.transparency.verify.buttonLabel}
        </button>
      </form>

      {result.kind === "not-found" && (
        <p className="text-sm text-black/60 dark:text-white/60">{strings.transparency.verify.notFound}</p>
      )}
      {result.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{strings.transparency.verify.error}</p>
      )}
      {result.kind === "fail" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {strings.transparency.verify.fail} ({result.reason})
        </p>
      )}
      {result.kind === "pass" && (
        <div className="text-sm text-green-700 dark:text-green-400 flex flex-col gap-1">
          <p>{result.anchored ? strings.transparency.verify.pass : strings.transparency.verify.passUnanchored}</p>
          <p className="text-black/50 dark:text-white/50">
            seq {result.proof.seq} · entry hash {result.proof.entryHash.slice(0, 16)}…
          </p>
        </div>
      )}
    </div>
  );
}
