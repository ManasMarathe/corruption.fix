import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { CONSENT_TIERS, complaints, offices } from "@/db/schema";
import { appendEntry } from "@/lib/chain";
import { checkOrigin, clientIp, errorResponse } from "@/lib/http";
import { log } from "@/lib/log";
import { limit } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { strings } from "@/lib/strings";
import { newId } from "@/lib/uuid";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  officeId: z.string().uuid(),
  serviceType: z.string().trim().min(1).max(100),
  bribeAmount: z.number().int().min(1).max(10 ** 8).optional(),
  designation: z.string().trim().min(1).max(100).optional(),
  officerName: z.string().trim().min(1).max(100).optional(),
  narrative: z.string().trim().min(30).max(5000),
  consentTier: z.enum(CONSENT_TIERS),
});

const REPORTER_LIMIT = { max: 5, windowSec: 24 * 60 * 60 };
const IP_LIMIT = { max: 20, windowSec: 24 * 60 * 60 };

/** YYYY-MM in UTC, matching the coarse monthly bucketing described on
 * `complaints.public_month` in the schema. */
function publicMonthOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorResponse(403, "bad_origin", strings.report.errors.badOrigin);
  }

  const session = await getSession();
  if (!session) {
    return errorResponse(401, "not_authenticated", strings.report.errors.notAuthenticated);
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(400, "invalid_body", strings.report.errors.invalidBody);
  }
  const { officeId, serviceType, bribeAmount, designation, officerName, narrative, consentTier } =
    parsed.data;

  const reporterLimit = await limit(
    "complaint-reporter",
    session.reporterId,
    REPORTER_LIMIT.max,
    REPORTER_LIMIT.windowSec
  );
  if (!reporterLimit.allowed) {
    return errorResponse(429, "rate_limited", strings.report.errors.rateLimited, {
      "Retry-After": String(reporterLimit.retryAfterSec),
    });
  }

  const ip = clientIp(request);
  const ipLimit = await limit("complaint-ip", ip, IP_LIMIT.max, IP_LIMIT.windowSec);
  if (!ipLimit.allowed) {
    return errorResponse(429, "rate_limited", strings.report.errors.rateLimited, {
      "Retry-After": String(ipLimit.retryAfterSec),
    });
  }

  try {
    const officeRows = await db
      .select({ id: offices.id })
      .from(offices)
      .where(eq(offices.id, officeId))
      .limit(1);
    if (officeRows.length === 0) {
      return errorResponse(400, "office_not_found", strings.report.errors.officeNotFound);
    }

    const complaintId = newId();
    const publicMonth = publicMonthOf(new Date());

    await db.transaction(async (tx) => {
      await tx.insert(complaints).values({
        id: complaintId,
        officeId,
        reporterId: session.reporterId,
        serviceType,
        bribeAmount: bribeAmount ?? null,
        designation: designation ?? null,
        officerNamePrivate: officerName ?? null,
        narrative,
        consentTier,
        status: "pending",
        publicMonth,
      });

      await appendEntry(tx, {
        id: complaintId,
        officeId,
        serviceType,
        bribeAmount: bribeAmount ?? null,
        designation: designation ?? null,
        narrative,
        consentTier,
        publicMonth,
      });
    });

    return NextResponse.json({ ok: true, complaintId });
  } catch (error) {
    log.error({ err: error }, "complaint submission failed");
    return errorResponse(500, "server_error", strings.report.errors.serverError);
  }
}
