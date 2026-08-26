import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reporterIdentities, vaultAccessLog } from "@/db/schema";
import { decrypt, encrypt, hmacEmail, normalizeEmail } from "./crypto";
import { newId } from "./uuid";

/**
 * The ONLY module allowed to touch `vault.*` tables (see the schema comment
 * in src/db/schema.ts). Reporter contact info is encrypted at rest and only
 * ever decrypted here, and every read/write against the vault is recorded
 * in `vault.vault_access_log` in the same transaction — including lookups
 * that don't decrypt anything, since knowing *that* a reporter identity was
 * accessed (and by what/whom, for what purpose) is itself sensitive.
 */

/** Free-text label for who/what performed a vault access, e.g. "self"
 * (the reporter acting on their own identity via OTP), "otp", or
 * "admin:<admin id>" for a staff-initiated escalation lookup. */
export type VaultAccessor = string;

export interface FindOrCreateIdentityResult {
  reporterId: string;
  verified: boolean;
}

type Executor = Pick<typeof db, "transaction">;

/**
 * Looks up a reporter identity by email (via HMAC — plaintext email is
 * never used as a query key). Creates one with a fresh UUIDv7 if none
 * exists yet. Always logs the access, whether the identity was found or
 * created.
 */
export async function findOrCreateIdentityByEmail(
  email: string,
  purpose: string,
  accessor: VaultAccessor = "self",
  executor: Executor = db
): Promise<FindOrCreateIdentityResult> {
  const emailHmac = hmacEmail(email);

  return executor.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(reporterIdentities)
      .where(eq(reporterIdentities.emailHmac, emailHmac))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      await tx.insert(vaultAccessLog).values({
        id: newId(),
        reporterId: row.id,
        accessor,
        purpose,
      });
      return { reporterId: row.id, verified: row.verifiedAt !== null };
    }

    const reporterId = newId();
    await tx.insert(reporterIdentities).values({
      id: reporterId,
      emailEnc: encrypt(normalizeEmail(email)),
      emailHmac,
      verifiedAt: null,
    });
    await tx.insert(vaultAccessLog).values({
      id: newId(),
      reporterId,
      accessor,
      purpose,
    });

    return { reporterId, verified: false };
  });
}

/** Marks a reporter identity as verified (called after a successful OTP
 * check). Logs the access. */
export async function markVerified(
  reporterId: string,
  accessor: VaultAccessor = "self",
  purpose: string = "otp_verify",
  executor: Executor = db
): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx
      .update(reporterIdentities)
      .set({ verifiedAt: new Date() })
      .where(eq(reporterIdentities.id, reporterId));

    await tx.insert(vaultAccessLog).values({
      id: newId(),
      reporterId,
      accessor,
      purpose,
    });
  });
}

/**
 * Decrypts and returns a reporter's email for a staff escalation flow
 * (e.g. handing an office/authority the contact info for a complaint the
 * reporter opted to escalate). Always writes a vault_access_log row, even
 * when the identity doesn't exist, so every attempted access is auditable.
 *
 * Returns null if no such identity exists.
 */
export async function getContactForEscalation(
  reporterId: string,
  accessor: VaultAccessor,
  purpose: string,
  executor: Executor = db
): Promise<string | null> {
  return executor.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(reporterIdentities)
      .where(eq(reporterIdentities.id, reporterId))
      .limit(1);

    await tx.insert(vaultAccessLog).values({
      id: newId(),
      reporterId,
      accessor,
      purpose,
    });

    if (rows.length === 0) return null;
    return decrypt(rows[0].emailEnc);
  });
}
