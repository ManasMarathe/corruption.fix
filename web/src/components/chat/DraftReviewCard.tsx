"use client";

import Link from "next/link";
import { useState } from "react";
import type { ComplaintDraft } from "@/lib/chat-tools";
import { strings } from "@/lib/strings";

// Mirrors db/schema.ts's CONSENT_TIERS. Kept as a local literal (rather
// than importing from @/db/schema) so this client component's bundle
// never pulls in server-only DB/Postgres dependencies — same convention
// as ReportForm.tsx.
const CONSENT_TIERS = ["publish_named", "publish_anon", "escalate_only"] as const;
type ConsentTier = (typeof CONSENT_TIERS)[number];

/**
 * Deterministic hand-off from the AI chat to the real submission path.
 * The assistant only produced a draft; everything from here on is plain
 * code — the user edits the fields, picks a consent tier, verifies their
 * email if needed, and this component POSTs /api/complaints exactly like
 * ReportForm does, so every server-side guard applies unchanged.
 *
 * Follow-up: extract the fetch/OTP plumbing shared with ReportForm.tsx
 * into a common hook.
 */

type Phase =
  | "review"
  | "consent"
  | "auth-request"
  | "auth-verify"
  | "submitting"
  | "success";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

export function DraftReviewCard({ draft }: { draft: ComplaintDraft }) {
  const [phase, setPhase] = useState<Phase>("review");
  const [error, setError] = useState<string | null>(null);

  const [serviceType, setServiceType] = useState(draft.serviceType);
  const [bribeAmount, setBribeAmount] = useState(
    draft.bribeAmount === undefined ? "" : String(draft.bribeAmount)
  );
  const [designation, setDesignation] = useState(draft.designation ?? "");
  const [officerName, setOfficerName] = useState(draft.officerName ?? "");
  const [narrative, setNarrative] = useState(draft.narrative);

  const [consentTier, setConsentTier] = useState<ConsentTier>("publish_anon");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [complaintId, setComplaintId] = useState<string | null>(null);

  function handleReviewContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (narrative.trim().length < 30) {
      setError(strings.report.errors.invalidBody);
      return;
    }
    setPhase("consent");
  }

  async function handleConsentContinue() {
    setError(null);
    try {
      const { body } = await fetchJson<{ authenticated: boolean }>("/api/auth/me");
      setPhase(body.authenticated ? "submitting" : "auth-request");
      if (body.authenticated) await submitComplaint();
    } catch {
      setError(strings.report.errors.serverError);
      setPhase("consent");
    }
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAuthBusy(true);
    try {
      const { status, body } = await fetchJson<{ error?: { message: string } }>(
        "/api/auth/request-otp",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );
      if (status !== 200) {
        setError(body.error?.message ?? strings.report.errors.serverError);
        return;
      }
      setPhase("auth-verify");
    } catch {
      setError(strings.report.errors.serverError);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAuthBusy(true);
    try {
      const { status, body } = await fetchJson<{ error?: { message: string } }>(
        "/api/auth/verify-otp",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        }
      );
      if (status !== 200) {
        setError(body.error?.message ?? strings.report.errors.serverError);
        return;
      }
      setPhase("submitting");
      await submitComplaint();
    } catch {
      setError(strings.report.errors.serverError);
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitComplaint() {
    setError(null);
    const amount = bribeAmount.trim() === "" ? undefined : Number(bribeAmount);
    try {
      const { status, body } = await fetchJson<{
        ok?: boolean;
        complaintId?: string;
        error?: { message: string };
      }>("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officeId: draft.officeId,
          serviceType: serviceType.trim(),
          bribeAmount: amount,
          designation: designation.trim() === "" ? undefined : designation.trim(),
          officerName: officerName.trim() === "" ? undefined : officerName.trim(),
          narrative: narrative.trim(),
          consentTier,
        }),
      });
      if (status !== 200 || !body.ok || !body.complaintId) {
        setError(body.error?.message ?? strings.report.errors.serverError);
        setPhase("consent");
        return;
      }
      setComplaintId(body.complaintId);
      setPhase("success");
    } catch {
      setError(strings.report.errors.serverError);
      setPhase("consent");
    }
  }

  const inputClass = "border rounded px-3 py-2 bg-transparent text-sm";
  const labelClass = "flex flex-col gap-1 text-sm";

  return (
    <div className="self-start w-full rounded-lg border border-black/10 dark:border-white/10 p-4 flex flex-col gap-3">
      {phase === "review" && (
        <form onSubmit={handleReviewContinue} className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm">{strings.chat.review.heading}</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            {strings.chat.review.body}
          </p>

          <p className="text-sm">
            <span className="text-black/60 dark:text-white/60">
              {strings.chat.review.officeLabel}:{" "}
            </span>
            {draft.officeName}
          </p>

          <label className={labelClass}>
            {strings.report.details.serviceTypeLabel}
            <input
              type="text"
              required
              maxLength={100}
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            {strings.report.details.bribeAmountLabel}
            <input
              type="number"
              min={1}
              max={100000000}
              value={bribeAmount}
              onChange={(e) => setBribeAmount(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            {strings.report.details.designationLabel}
            <input
              type="text"
              maxLength={100}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            {strings.report.details.officerNameLabel}
            <input
              type="text"
              maxLength={100}
              value={officerName}
              onChange={(e) => setOfficerName(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-black/50 dark:text-white/50">
              {strings.report.details.officerNameHint}
            </span>
          </label>

          <label className={labelClass}>
            {strings.report.details.narrativeLabel}
            <textarea
              required
              minLength={30}
              maxLength={5000}
              rows={5}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs text-black/50 dark:text-white/50">
              {strings.report.details.narrativeHint} ({narrative.trim().length}/5000)
            </span>
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium"
          >
            {strings.chat.review.continueButton}
          </button>
        </form>
      )}

      {phase === "consent" && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm">{strings.report.consent.heading}</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            {strings.report.consent.body}
          </p>

          <div className="flex flex-col gap-2">
            {CONSENT_TIERS.map((tier) => (
              <label
                key={tier}
                className={`flex flex-col gap-1 border rounded px-3 py-2 cursor-pointer ${
                  consentTier === tier
                    ? "border-foreground"
                    : "border-black/15 dark:border-white/15"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name={`chat-consent-${draft.officeId}`}
                    checked={consentTier === tier}
                    onChange={() => setConsentTier(tier)}
                  />
                  {strings.report.consent.tiers[tier].label}
                </span>
                <span className="text-xs text-black/60 dark:text-white/60">
                  {strings.report.consent.tiers[tier].description}
                </span>
              </label>
            ))}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPhase("review")}
              className="rounded border px-4 py-2 text-sm font-medium"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleConsentContinue}
              className="flex-1 rounded bg-foreground text-background px-4 py-2 text-sm font-medium"
            >
              {strings.report.consent.submitButton}
            </button>
          </div>
        </div>
      )}

      {phase === "auth-request" && (
        <form onSubmit={handleRequestOtp} className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm">{strings.report.auth.heading}</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            {strings.report.auth.body}
          </p>
          <label className={labelClass}>
            {strings.report.auth.emailLabel}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={strings.report.auth.emailPlaceholder}
              className={inputClass}
            />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={authBusy}
            className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {authBusy ? strings.report.auth.sendingCode : strings.report.auth.sendCodeButton}
          </button>
        </form>
      )}

      {phase === "auth-verify" && (
        <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm">{strings.report.auth.heading}</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            {strings.report.auth.codeSentTo(email)}
          </p>
          <label className={labelClass}>
            {strings.report.auth.codeLabel}
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={strings.report.auth.codePlaceholder}
              className={`${inputClass} tracking-widest`}
            />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={authBusy}
            className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {authBusy ? strings.report.auth.verifying : strings.report.auth.verifyButton}
          </button>
          <div className="flex justify-between text-xs">
            <button type="button" onClick={handleRequestOtp} className="underline">
              {strings.report.auth.resendButton}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("auth-request");
                setCode("");
                setError(null);
              }}
              className="underline"
            >
              {strings.report.auth.changeEmailButton}
            </button>
          </div>
        </form>
      )}

      {phase === "submitting" && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {strings.report.consent.submitting}
        </p>
      )}

      {phase === "success" && complaintId && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-sm">{strings.report.success.heading}</h3>
          <p className="text-sm">{strings.report.success.body(complaintId)}</p>
          <div className="flex gap-4 text-sm">
            <Link href={`/office/${draft.officeId}`} className="underline">
              {strings.report.success.backToOffice}
            </Link>
            <Link href="/transparency" className="underline">
              {strings.report.success.viewTransparency}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
