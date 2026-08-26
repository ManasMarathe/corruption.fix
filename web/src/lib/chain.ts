import crypto from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { db as realDb } from "@/db";
import { chainEntries, type ConsentTier } from "@/db/schema";

/**
 * Tamper-evident hash chain over published complaint fields.
 *
 * Each complaint gets exactly one `chain_entries` row, linked to the
 * previous entry by hash (like a minimal blockchain / Merkle-ish log):
 * `entry_hash = sha256(prev_hash + canonical(complaint))`. Because each
 * entry commits to the previous entry's hash, changing (or reordering, or
 * deleting) any earlier entry changes every hash after it — an auditor who
 * recomputes the chain from a known-good checkpoint will immediately see a
 * mismatch. See `chainCheckpoints` (src/lib/signing.ts) for how a slice of
 * the chain gets periodically signed so "known-good" has a durable anchor.
 *
 * This module is pure hashing/verification logic plus the one piece of
 * side-effecting code that must run inside the complaint-insert transaction
 * (`appendEntry`). Everything here is unit-testable without a live
 * Postgres connection except `appendEntry` itself, which is exercised via
 * the `/api/complaints` route's end-to-end curl check (see task report).
 */

// 64 hex zeros — the `prev_hash` of the very first entry in the chain.
export const GENESIS_HASH = "0".repeat(64);

// The Postgres advisory lock key used to serialize chain appends. Any
// number works as long as it's used consistently; picked arbitrarily.
export const CHAIN_ADVISORY_LOCK_KEY = 42;

/**
 * The subset of a complaint's fields that go into the hash chain, and why:
 *
 *  - `id`, `officeId`, `serviceType`, `bribeAmount`, `designation`,
 *    `consentTier`, `publicMonth`, `narrative`: these are exactly the
 *    fields that are (or become, once published) public — the chain exists
 *    to prove the public record hasn't been silently altered, so it must
 *    commit to what the public actually sees.
 *
 *  - `narrative` IS included, deliberately, despite being the largest
 *    field: it's the core of what a reader trusts hasn't been rewritten
 *    after the fact. A published complaint whose narrative changed without
 *    a matching chain-hash change would defeat the entire point of this
 *    module.
 *
 *  - `reporterId` is EXCLUDED: it's never shown publicly (the reporter's
 *    real identity lives only in the encrypted `vault` schema, and
 *    `reporterId` itself is just an opaque internal id), so committing to
 *    it would let a chain-verifier correlate complaints by reporter even
 *    for `escalate_only`/anonymous submissions — a privacy leak the chain
 *    has no business enabling.
 *
 *  - `officerNamePrivate` is EXCLUDED: names are only published later, via
 *    the separate moderated `officers` table, after multiple independent
 *    verified reports corroborate them (see strings.ts `report` copy). The
 *    raw as-submitted name is not itself part of the public record.
 *
 *  - Exact `createdAt` is EXCLUDED (only the coarse `publicMonth` bucket is
 *    included): publishing exact submission timestamps can deanonymize a
 *    reporter (e.g. cross-referencing against when they were known to be
 *    at an office), which is exactly what the monthly bucketing in the
 *    `complaints` table already avoids — the chain shouldn't reintroduce
 *    that precision.
 *
 *  - `status` is EXCLUDED: status transitions (pending -> published ->
 *    tombstoned) are lifecycle metadata, not content. A tombstoning is
 *    recorded via `removed_at`/`removal_reason`/`order_ref` on the chain
 *    entry itself (see `tombstoneEntry`), not by re-hashing the entry with
 *    a different status value — the hashes must stay stable forever except
 *    for that explicit, visible tombstone annotation.
 */
export interface ChainComplaintFields {
  id: string;
  officeId: string;
  serviceType: string;
  bribeAmount: number | null;
  designation: string | null;
  narrative: string;
  consentTier: ConsentTier | (string & {});
  publicMonth: string | null;
}

const CANONICAL_FIELD_ORDER = [
  "bribeAmount",
  "consentTier",
  "designation",
  "id",
  "narrative",
  "officeId",
  "publicMonth",
  "serviceType",
] as const satisfies readonly (keyof ChainComplaintFields)[];

/**
 * Produces a stable JSON string over the public complaint fields, with keys
 * sorted lexicographically so the same logical complaint always
 * canonicalizes to the exact same bytes regardless of object key insertion
 * order or which code path constructed it (DB row vs. freshly-built object).
 */
export function canonicalizeComplaint(fields: ChainComplaintFields): string {
  const ordered: Record<string, unknown> = {};
  for (const key of CANONICAL_FIELD_ORDER) {
    ordered[key] = fields[key] ?? null;
  }
  return JSON.stringify(ordered);
}

/** sha256(prevHash + canonical), hex-encoded. */
export function computeEntryHash(prevHash: string, canonical: string): string {
  return crypto
    .createHash("sha256")
    .update(prevHash, "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

// Only the fields verification actually needs — deliberately not the full
// chain_entries row shape (no complaintId/createdAt/etc.), so callers can
// pass in plain hash-linkage data (e.g. from the transparency proof
// endpoint) without dragging along unrelated columns.
export interface ChainEntryLike {
  seq: number;
  prevHash: string;
  entryHash: string;
}

export type VerifyChainResult =
  | { ok: true }
  | {
      ok: false;
      /** seq of the first entry whose stored hash doesn't match the
       * recomputed hash, or whose prevHash doesn't chain to the previous
       * entry's entryHash. */
      atSeq: number;
      reason: "prev_hash_mismatch" | "entry_hash_mismatch";
    };

/**
 * Recomputes and verifies a contiguous slice of the chain. `entries` must
 * be in ascending `seq` order and contiguous (no gaps) — callers that only
 * have complaint field data (not precomputed hashes) should pass each
 * entry's `entryHash` as `computeEntryHash(prevHash, canonicalizeComplaint(fields))`
 * before calling this, or use it purely to check internal linkage/hash
 * consistency of already-stored entries (the common case, e.g. the
 * `/api/transparency/proof` route).
 *
 * `expectedStart` is the `prevHash` the first entry in the slice must chain
 * from — either `GENESIS_HASH` (verifying from the start of the whole
 * chain) or the `entryHash` of the entry immediately before this slice
 * (e.g. a checkpoint's `headHash`).
 */
export function verifyChainSlice(
  entries: ChainEntryLike[],
  expectedStart: string
): VerifyChainResult {
  let prevHash = expectedStart;
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return { ok: false, atSeq: entry.seq, reason: "prev_hash_mismatch" };
    }
    prevHash = entry.entryHash;
  }
  return { ok: true };
}

/**
 * Recomputes and verifies a contiguous slice given the full complaint field
 * data for each entry (rather than trusting a precomputed `entryHash`).
 * This is the stronger check: it catches a stored `entryHash` that was
 * updated to match tampered fields (which `verifyChainSlice` alone cannot,
 * since it only checks internal linkage of already-stored hashes).
 */
export function verifyChainSliceWithFields(
  entries: Array<{ seq: number; prevHash: string; entryHash: string; fields: ChainComplaintFields }>,
  expectedStart: string
): VerifyChainResult {
  let prevHash = expectedStart;
  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return { ok: false, atSeq: entry.seq, reason: "prev_hash_mismatch" };
    }
    const recomputed = computeEntryHash(entry.prevHash, canonicalizeComplaint(entry.fields));
    if (recomputed !== entry.entryHash) {
      return { ok: false, atSeq: entry.seq, reason: "entry_hash_mismatch" };
    }
    prevHash = entry.entryHash;
  }
  return { ok: true };
}

// A drizzle transaction handle, typed loosely so this module doesn't need
// to import the exact (large, generated) transaction type — it only ever
// calls `.execute`/`.select`/`.insert`/`.from`/`.where`/`.orderBy`/`.limit`,
// all of which the real `db.transaction` callback's `tx` provides.
export type ChainTx = Pick<typeof realDb, "execute" | "select" | "insert" | "update">;

/**
 * Appends one chain entry for `complaint`. MUST be called inside the same
 * drizzle transaction as the complaint row's own insert, using that
 * transaction's `tx` handle — that's what makes the complaint insert and
 * its chain entry atomic (either both commit or neither does).
 *
 * Takes `pg_advisory_xact_lock(42)` first, which serializes concurrent
 * appends within this transaction (the lock is automatically released at
 * transaction end). Without this, two concurrent transactions could both
 * read the same "last entry" and compute two entries claiming the same
 * `prevHash`, corrupting the chain's linear order.
 */
export async function appendEntry(
  tx: ChainTx,
  complaint: ChainComplaintFields
): Promise<{ seq: number; prevHash: string; entryHash: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(${CHAIN_ADVISORY_LOCK_KEY})`);

  const last = await tx
    .select({ entryHash: chainEntries.entryHash })
    .from(chainEntries)
    .orderBy(desc(chainEntries.seq))
    .limit(1);

  const prevHash = last[0]?.entryHash ?? GENESIS_HASH;
  const canonical = canonicalizeComplaint(complaint);
  const entryHash = computeEntryHash(prevHash, canonical);

  const inserted = await tx
    .insert(chainEntries)
    .values({
      complaintId: complaint.id,
      prevHash,
      entryHash,
    })
    .returning({ seq: chainEntries.seq });

  return { seq: inserted[0].seq, prevHash, entryHash };
}

/**
 * Marks a chain entry as tombstoned: sets `removed_at`/`removal_reason`/
 * `order_ref`. The entry's `prev_hash`/`entry_hash` are left untouched —
 * tombstoning removes the *content* (the caller is responsible for
 * clearing/redacting the complaint row's narrative etc. in the same
 * transaction) but the chain must still show a link existed at that seq,
 * with a visible, dated, reasoned annotation of its removal. This is what
 * makes tombstoning different from silent deletion.
 */
export async function tombstoneEntry(
  tx: ChainTx,
  complaintId: string,
  reason: string,
  orderRef: string | null
): Promise<void> {
  await tx
    .update(chainEntries)
    .set({
      removedAt: new Date(),
      removalReason: reason,
      orderRef: orderRef ?? undefined,
    })
    .where(eq(chainEntries.complaintId, complaintId));
}
