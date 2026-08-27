import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/http";
import { checkJobAuth, isJobName, runJob } from "@/lib/jobs";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Dispatcher for the scheduled maintenance jobs (see src/lib/jobs.ts and
 * .github/workflows/jobs.yml). Requires `Authorization: Bearer
 * <JOB_SECRET>` — there's no session/cookie auth here since the caller is
 * a GitHub Actions workflow, not a browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> }
) {
  if (!checkJobAuth(request.headers.get("authorization"))) {
    return errorResponse(401, "unauthorized", "Missing or invalid job credentials.");
  }

  const { job } = await params;
  if (!isJobName(job)) {
    return errorResponse(404, "not_found", `Unknown job: ${job}`);
  }

  try {
    const result = await runJob(job);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    log.error({ err: error, job }, "job run failed");
    return errorResponse(500, "server_error", "Job failed.");
  }
}
