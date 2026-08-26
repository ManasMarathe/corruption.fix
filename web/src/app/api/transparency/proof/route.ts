import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { chainCheckpoints, chainEntries, complaints } from "@/db/schema";
import type { ChainComplaintFields } from "@/lib/chain";
import { env } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { isValidId } from "@/lib/uuid";

export const dynamic = "force-dynamic";

// The chain slice returned to anchor an entry to its nearest checkpoint is
// capped at this many entries so a single proof request can't be used to
// pull an unbounded amount of the chain in one call. If an entry's nearest
// covering checkpoint is further away than this, the response is a 400
// rather than a silently-truncated (and therefore misleading) slice —
// callers should verify against a more recent, closer checkpoint instead.
const MAX_CHAIN_SLICE = 1000;

interface ChainSliceEntry {
  seq: number;
  prevHash: string;
  entryHash: string;
}

export async function GET(request: NextRequest) {
  const complaintId = request.nextUrl.searchParams.get("complaint");
  if (!complaintId || !isValidId(complaintId)) {
    return errorResponse(400, "invalid_id", "A valid complaint id is required.");
  }

  try {
    const complaintRows = await db
      .select({
        id: complaints.id,
        officeId: complaints.officeId,
        serviceType: complaints.serviceType,
        bribeAmount: complaints.bribeAmount,
        designation: complaints.designation,
        narrative: complaints.narrative,
        consentTier: complaints.consentTier,
        publicMonth: complaints.publicMonth,
      })
      .from(complaints)
      .where(eq(complaints.id, complaintId))
      .limit(1);
    const complaint = complaintRows[0];
    if (!complaint) {
      return errorResponse(404, "not_found", "No report found with that reference id.");
    }

    const entryRows = await db
      .select({
        seq: chainEntries.seq,
        prevHash: chainEntries.prevHash,
        entryHash: chainEntries.entryHash,
      })
      .from(chainEntries)
      .where(eq(chainEntries.complaintId, complaintId))
      .limit(1);
    const entry = entryRows[0];
    if (!entry) {
      // Should be unreachable in practice — every complaint gets a chain
      // entry in the same transaction as its insert (see appendEntry in
      // src/lib/chain.ts) — but handled defensively rather than 500ing.
      return errorResponse(404, "not_found", "No chain entry found for that report.");
    }

    const checkpointRows = await db
      .select({
        toSeq: chainCheckpoints.toSeq,
        headHash: chainCheckpoints.headHash,
        signature: chainCheckpoints.signature,
      })
      .from(chainCheckpoints)
      .where(gte(chainCheckpoints.toSeq, entry.seq))
      .orderBy(asc(chainCheckpoints.toSeq))
      .limit(1);
    const nearestCheckpoint = checkpointRows[0] ?? null;

    let chainSlice: ChainSliceEntry[];
    if (nearestCheckpoint) {
      const rangeSize = nearestCheckpoint.toSeq - entry.seq + 1;
      if (rangeSize > MAX_CHAIN_SLICE) {
        return errorResponse(
          400,
          "range_too_large",
          `This report's nearest checkpoint covers ${rangeSize} entries, over the ${MAX_CHAIN_SLICE}-entry proof limit. Verify against a more recent checkpoint once one is signed.`
        );
      }
      chainSlice = await db
        .select({
          seq: chainEntries.seq,
          prevHash: chainEntries.prevHash,
          entryHash: chainEntries.entryHash,
        })
        .from(chainEntries)
        .where(and(gte(chainEntries.seq, entry.seq), lte(chainEntries.seq, nearestCheckpoint.toSeq)))
        .orderBy(asc(chainEntries.seq));
    } else {
      // No checkpoint has been signed yet that covers this entry — the
      // slice is just the entry itself, so callers can still verify its
      // own hash even though there's no signed anchor to chain it to yet.
      chainSlice = [entry];
    }

    // Reports submitted under the "escalate_only" consent tier are never
    // meant to reach public view — withhold the field content (narrative
    // etc.) that recomputing the hash would otherwise require exposing.
    // The hash/chain-linkage proof (seq, entryHash, prevHash, chainSlice)
    // is still returned, so the *fact* that a report exists and where it
    // sits in the chain remains independently verifiable either way.
    const canonicalFields: ChainComplaintFields | null =
      complaint.consentTier === "escalate_only"
        ? null
        : {
            id: complaint.id,
            officeId: complaint.officeId,
            serviceType: complaint.serviceType,
            bribeAmount: complaint.bribeAmount,
            designation: complaint.designation,
            narrative: complaint.narrative,
            consentTier: complaint.consentTier,
            publicMonth: complaint.publicMonth,
          };

    return NextResponse.json({
      seq: entry.seq,
      entryHash: entry.entryHash,
      prevHash: entry.prevHash,
      consentTier: complaint.consentTier,
      canonicalFields,
      nearestCheckpoint: nearestCheckpoint
        ? {
            toSeq: nearestCheckpoint.toSeq,
            headHash: nearestCheckpoint.headHash,
            signature: nearestCheckpoint.signature,
            publicKey: env.CHECKPOINT_PUBLIC_KEY ?? null,
          }
        : null,
      chainSlice,
    });
  } catch (error) {
    log.error({ err: error }, "transparency proof lookup failed");
    return errorResponse(500, "server_error", "Something went wrong. Please try again.");
  }
}
