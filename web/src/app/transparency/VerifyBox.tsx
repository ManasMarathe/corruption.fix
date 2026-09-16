"use client";

import { useState } from "react";
import { strings } from "@/lib/strings";
import { verifyProof, type ProofResponse, type ProofVerdict } from "@/lib/proof-verify";

/**
 * Looks up a report's proof and verifies it entirely in the reader's own
 * browser. All the cryptography lives in `@/lib/proof-verify` — a pure,
 * Web-Crypto-only module with its own tests, including tests that assert it
 * canonicalizes and hashes exactly like the server does, so the two
 * implementations cannot drift apart unnoticed.
 */

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error" }
  | { kind: "verdict"; verdict: ProofVerdict; proof: ProofResponse };

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
      setResult({ kind: "verdict", verdict: await verifyProof(proof), proof });
    } catch {
      setResult({ kind: "error" });
    }
  }

  const v = strings.transparency.verify;

  function renderVerdict(verdict: ProofVerdict, proof: ProofResponse) {
    if (!verdict.ok) {
      const message =
        verdict.reason === "checkpoint_signature_invalid" ? v.failSignature : v.fail;
      return (
        <p className="text-sm text-red-600 dark:text-red-400">
          {message} ({verdict.reason})
        </p>
      );
    }

    // A pass whose signature could not be tested is reported in a warning
    // tone, not a green one — it is a weaker statement than a full pass.
    const unverifiedSignature = verdict.anchored && verdict.signature !== "valid";
    const message = !verdict.anchored
      ? v.passUnanchored
      : unverifiedSignature
        ? v.passUnverifiedSignature
        : v.pass;

    return (
      <div
        className={`text-sm flex flex-col gap-1 ${
          unverifiedSignature
            ? "text-amber-700 dark:text-amber-400"
            : "text-green-700 dark:text-green-400"
        }`}
      >
        <p>{message}</p>
        <p className="text-black/50 dark:text-white/50">
          seq {proof.seq} · entry hash {proof.entryHash.slice(0, 16)}…
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-5 flex flex-col gap-3 border-black/15 dark:border-white/15">
      <h2 className="text-lg font-semibold">{v.heading}</h2>
      <p className="text-sm text-black/70 dark:text-white/70">{v.body}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={v.inputPlaceholder}
          aria-label={v.inputLabel}
          className="flex-1 border rounded px-3 py-2 bg-transparent text-sm"
        />
        <button
          type="submit"
          disabled={result.kind === "loading"}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {result.kind === "loading" ? v.verifying : v.buttonLabel}
        </button>
      </form>

      {result.kind === "not-found" && (
        <p className="text-sm text-black/60 dark:text-white/60">{v.notFound}</p>
      )}
      {result.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{v.error}</p>
      )}
      {result.kind === "verdict" && renderVerdict(result.verdict, result.proof)}
    </div>
  );
}
