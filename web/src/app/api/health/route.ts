import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { log } from "@/lib/log";

// Always evaluate live — this endpoint reports current DB connectivity, so
// it must never be statically cached or prerendered.
export const dynamic = "force-dynamic";

type JobRunRow = {
  job_name: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  ok: boolean | null;
  detail: string | null;
};

type LastJobSummary = {
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  detail: string | null;
};

type HealthResponse = {
  ok: boolean;
  db: boolean;
  lastJobs: LastJobSummary[];
};

export async function GET() {
  try {
    // Simple connectivity probe.
    await db.execute(sql`SELECT 1`);

    // Latest run per job, so an operator can see at a glance which
    // scheduled jobs are healthy without querying job_runs directly.
    const rows = await db.execute<JobRunRow>(sql`
      SELECT DISTINCT ON (job_name)
        job_name, started_at, finished_at, ok, detail
      FROM job_runs
      ORDER BY job_name, started_at DESC
    `);

    const lastJobs: LastJobSummary[] = rows.map((row) => ({
      jobName: row.job_name,
      startedAt: new Date(row.started_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      ok: row.ok,
      detail: row.detail,
    }));

    const body: HealthResponse = { ok: true, db: true, lastJobs };
    return NextResponse.json(body);
  } catch (error) {
    log.error({ err: error }, "health check failed: database unreachable");
    const body: HealthResponse = { ok: false, db: false, lastJobs: [] };
    return NextResponse.json(body, { status: 503 });
  }
}
