import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chainCheckpoints, chainEntries, jobRuns } from "@/db/schema";
import { constantTimeEqual } from "./crypto";
import { env } from "./env";
import { checkpointPayload, signPayload } from "./signing";
import { newId } from "./uuid";

/**
 * Scheduled maintenance jobs, run via POST /api/jobs/[job] (see
 * src/app/api/jobs/[job]/route.ts) by the GitHub Actions workflow in
 * .github/workflows/jobs.yml on a 30-minute cron, authenticated with a
 * `Authorization: Bearer <JOB_SECRET>` header.
 */

export interface JobResult {
  ok: boolean;
  detail: string;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Constant-time check of an `Authorization` header against `JOB_SECRET`.
 * Pure (no DB, no Next.js types) so it's directly unit-testable — see
 * jobs.test.ts. Missing header, wrong scheme, or wrong token all fail the
 * same way (no timing or error-message signal that distinguishes them).
 */
export function checkJobAuth(authorizationHeader: string | null | undefined): boolean {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return false;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  return constantTimeEqual(token, env.JOB_SECRET);
}

/**
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY office_stats` — see
 * drizzle/0001_office_stats_matview.sql for why this is the only path
 * that's allowed to update office_stats, and why CONCURRENTLY (it needs
 * the view's unique index, which that migration creates, but avoids
 * locking out readers mid-refresh, unlike a plain REFRESH).
 */
export async function refreshStats(): Promise<JobResult> {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY office_stats`);
  return { ok: true, detail: "office_stats refreshed" };
}

/**
 * Signs a new chain checkpoint covering every chain_entries row appended
 * since the last checkpoint, if any and if a signing key is configured.
 * See src/lib/signing.ts for the Ed25519 seed/signing mechanics and
 * src/lib/chain.ts for the hash chain this is checkpointing.
 */
export async function signCheckpoint(): Promise<JobResult> {
  if (!env.CHECKPOINT_SIGNING_KEY) {
    return { ok: true, detail: "no signing key" };
  }

  return db.transaction(async (tx) => {
    const lastCheckpoint = await tx
      .select({ toSeq: chainCheckpoints.toSeq })
      .from(chainCheckpoints)
      .orderBy(desc(chainCheckpoints.toSeq))
      .limit(1);
    const fromSeq = (lastCheckpoint[0]?.toSeq ?? 0) + 1;

    const latestEntry = await tx
      .select({ seq: chainEntries.seq, entryHash: chainEntries.entryHash })
      .from(chainEntries)
      .orderBy(desc(chainEntries.seq))
      .limit(1);
    const toSeq = latestEntry[0]?.seq;

    if (toSeq === undefined || toSeq < fromSeq) {
      return { ok: true, detail: "no new entries" };
    }

    const headHash = latestEntry[0].entryHash;
    const payload = checkpointPayload(fromSeq, toSeq, headHash);
    const signature = signPayload(env.CHECKPOINT_SIGNING_KEY as string, payload);

    await tx.insert(chainCheckpoints).values({
      id: newId(),
      fromSeq,
      toSeq,
      headHash,
      signature,
    });

    return { ok: true, detail: `checkpointed seq ${fromSeq}-${toSeq}` };
  });
}

/**
 * Threshold-based moderation/escalation evaluation (e.g. auto-publishing
 * complaints once N independent verified reports corroborate an officer
 * name). Not built yet — this is a stub that records a clean, honest
 * job_runs entry so the scheduled workflow doesn't fail while phase 3
 * (moderation) is still unbuilt.
 */
export async function evaluateThresholds(): Promise<JobResult> {
  return { ok: true, detail: "phase-3" };
}

export const JOB_NAMES = ["refresh-stats", "sign-checkpoint", "evaluate-thresholds"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

const JOB_FNS: Record<JobName, () => Promise<JobResult>> = {
  "refresh-stats": refreshStats,
  "sign-checkpoint": signCheckpoint,
  "evaluate-thresholds": evaluateThresholds,
};

export interface JobRunOutcome {
  id: string;
  ok: boolean;
  detail: string;
}

/**
 * Runs `jobName`, recording a `job_runs` row that spans the whole
 * attempt — inserted (started) before the job runs, updated (finished,
 * ok, detail) after, whether the job succeeds, returns `ok: false`, or
 * throws. A thrown error is recorded with `ok: false` and the error
 * message as `detail`, then re-thrown so the route handler can log it and
 * return 500.
 */
export async function runJob(jobName: JobName): Promise<JobRunOutcome> {
  const id = newId();
  await db.insert(jobRuns).values({ id, jobName, startedAt: new Date() });

  try {
    const result = await JOB_FNS[jobName]();
    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), ok: result.ok, detail: result.detail })
      .where(eq(jobRuns.id, id));
    return { id, ok: result.ok, detail: result.detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), ok: false, detail })
      .where(eq(jobRuns.id, id));
    throw error;
  }
}
