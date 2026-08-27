"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { strings } from "@/lib/strings";

// Mirrors db/schema.ts's CONSENT_TIERS. Kept as a local literal (rather
// than importing from @/db/schema) so this client component's bundle
// never pulls in server-only DB/Postgres dependencies.
const CONSENT_TIERS = ["publish_named", "publish_anon", "escalate_only"] as const;
type ConsentTier = (typeof CONSENT_TIERS)[number];

type Phase =
  | "loading"
  | "no-office"
  | "auth-request"
  | "auth-verify"
  | "details"
  | "consent"
  | "submitting"
  | "success"
  | "fatal-error";

interface OfficeContext {
  id: string;
  name: string;
  category: string;
}

interface DetailsState {
  serviceType: string;
  bribeAmount: string;
  designation: string;
  officerName: string;
  narrative: string;
}

const EMPTY_DETAILS: DetailsState = {
  serviceType: "",
  bribeAmount: "",
  designation: "",
  officerName: "",
  narrative: "",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

export function ReportForm() {
  const searchParams = useSearchParams();
  const officeId = searchParams.get("office");

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [office, setOffice] = useState<OfficeContext | null>(null);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [details, setDetails] = useState<DetailsState>(EMPTY_DETAILS);
  const [consentTier, setConsentTier] = useState<ConsentTier>("publish_anon");
  const [complaintId, setComplaintId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!officeId) {
        setPhase("no-office");
        return;
      }

      try {
        const [officeRes, meRes] = await Promise.all([
          fetchJson<OfficeContext>(`/api/complaints/office-context?id=${encodeURIComponent(officeId)}`),
          fetchJson<{ authenticated: boolean }>("/api/auth/me"),
        ]);
        if (cancelled) return;

        if (officeRes.status !== 200) {
          setPhase("fatal-error");
          setError(strings.report.errors.officeNotFound);
          return;
        }
        setOffice(officeRes.body);
        setPhase(meRes.body.authenticated ? "details" : "auth-request");
      } catch {
        if (!cancelled) {
          setPhase("fatal-error");
          setError(strings.report.errors.serverError);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [officeId]);

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
      setPhase("details");
    } catch {
      setError(strings.report.errors.serverError);
    } finally {
      setAuthBusy(false);
    }
  }

  function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (details.narrative.trim().length < 30) {
      setError(strings.report.errors.invalidBody);
      return;
    }
    setPhase("consent");
  }

  async function handleFinalSubmit() {
    if (!office) return;
    setError(null);
    setPhase("submitting");

    const bribeAmount = details.bribeAmount.trim() === "" ? undefined : Number(details.bribeAmount);

    try {
      const { status, body } = await fetchJson<{ ok?: boolean; complaintId?: string; error?: { message: string } }>(
        "/api/complaints",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            officeId: office.id,
            serviceType: details.serviceType.trim(),
            bribeAmount,
            designation: details.designation.trim() === "" ? undefined : details.designation.trim(),
            officerName: details.officerName.trim() === "" ? undefined : details.officerName.trim(),
            narrative: details.narrative.trim(),
            consentTier,
          }),
        }
      );
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

  return (
    <div className="font-sans min-h-screen flex flex-col items-center p-8">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-tight">{strings.report.meta.title}</h1>

        {office && phase !== "success" && (
          <p className="text-sm text-black/60 dark:text-white/60">
            {office.name}
          </p>
        )}

        {phase === "loading" && <p className="text-black/60 dark:text-white/60">…</p>}

        {phase === "no-office" && (
          <p className="text-black/70 dark:text-white/70">
            Pick an office from the map first, then come back here to report.{" "}
            <Link href="/" className="underline">
              Go to the map
            </Link>
          </p>
        )}

        {phase === "fatal-error" && (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        )}

        {phase === "auth-request" && (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{strings.report.auth.heading}</h2>
            <p className="text-sm text-black/70 dark:text-white/70">{strings.report.auth.body}</p>
            <label className="flex flex-col gap-1 text-sm">
              {strings.report.auth.emailLabel}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={strings.report.auth.emailPlaceholder}
                className="border rounded px-3 py-2 bg-transparent"
              />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={authBusy}
              className="rounded bg-foreground text-background px-4 py-2 font-medium disabled:opacity-50"
            >
              {authBusy ? strings.report.auth.sendingCode : strings.report.auth.sendCodeButton}
            </button>
          </form>
        )}

        {phase === "auth-verify" && (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{strings.report.auth.heading}</h2>
            <p className="text-sm text-black/70 dark:text-white/70">
              {strings.report.auth.codeSentTo(email)}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              {strings.report.auth.codeLabel}
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={strings.report.auth.codePlaceholder}
                className="border rounded px-3 py-2 bg-transparent tracking-widest"
              />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={authBusy}
              className="rounded bg-foreground text-background px-4 py-2 font-medium disabled:opacity-50"
            >
              {authBusy ? strings.report.auth.verifying : strings.report.auth.verifyButton}
            </button>
            <div className="flex justify-between text-sm">
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

        {phase === "details" && (
          <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{strings.report.details.heading}</h2>

            <label className="flex flex-col gap-1 text-sm">
              {strings.report.details.serviceTypeLabel}
              <input
                type="text"
                required
                maxLength={100}
                value={details.serviceType}
                onChange={(e) => setDetails({ ...details, serviceType: e.target.value })}
                placeholder={strings.report.details.serviceTypePlaceholder}
                className="border rounded px-3 py-2 bg-transparent"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {strings.report.details.bribeAmountLabel}
              <input
                type="number"
                min={1}
                max={100000000}
                value={details.bribeAmount}
                onChange={(e) => setDetails({ ...details, bribeAmount: e.target.value })}
                className="border rounded px-3 py-2 bg-transparent"
              />
              <span className="text-xs text-black/50 dark:text-white/50">
                {strings.report.details.bribeAmountHint}
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {strings.report.details.designationLabel}
              <input
                type="text"
                maxLength={100}
                value={details.designation}
                onChange={(e) => setDetails({ ...details, designation: e.target.value })}
                placeholder={strings.report.details.designationPlaceholder}
                className="border rounded px-3 py-2 bg-transparent"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {strings.report.details.officerNameLabel}
              <input
                type="text"
                maxLength={100}
                value={details.officerName}
                onChange={(e) => setDetails({ ...details, officerName: e.target.value })}
                className="border rounded px-3 py-2 bg-transparent"
              />
              <span className="text-xs text-black/50 dark:text-white/50">
                {strings.report.details.officerNameHint}
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {strings.report.details.narrativeLabel}
              <textarea
                required
                minLength={30}
                maxLength={5000}
                rows={6}
                value={details.narrative}
                onChange={(e) => setDetails({ ...details, narrative: e.target.value })}
                className="border rounded px-3 py-2 bg-transparent"
              />
              <span className="text-xs text-black/50 dark:text-white/50">
                {strings.report.details.narrativeHint} ({details.narrative.trim().length}/5000)
              </span>
            </label>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              className="rounded bg-foreground text-background px-4 py-2 font-medium"
            >
              {strings.report.details.continueButton}
            </button>
          </form>
        )}

        {phase === "consent" && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{strings.report.consent.heading}</h2>
            <p className="text-sm text-black/70 dark:text-white/70">{strings.report.consent.body}</p>

            <div className="flex flex-col gap-3">
              {CONSENT_TIERS.map((tier) => (
                <label
                  key={tier}
                  className={`flex flex-col gap-1 border rounded px-4 py-3 cursor-pointer ${
                    consentTier === tier ? "border-foreground" : "border-black/15 dark:border-white/15"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="consentTier"
                      checked={consentTier === tier}
                      onChange={() => setConsentTier(tier)}
                    />
                    {strings.report.consent.tiers[tier].label}
                  </span>
                  <span className="text-sm text-black/60 dark:text-white/60">
                    {strings.report.consent.tiers[tier].description}
                  </span>
                </label>
              ))}
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPhase("details")}
                className="rounded border px-4 py-2 font-medium"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                className="flex-1 rounded bg-foreground text-background px-4 py-2 font-medium"
              >
                {strings.report.consent.submitButton}
              </button>
            </div>
          </div>
        )}

        {phase === "submitting" && (
          <p className="text-black/60 dark:text-white/60">{strings.report.consent.submitting}</p>
        )}

        {phase === "success" && complaintId && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{strings.report.success.heading}</h2>
            <p className="text-sm">{strings.report.success.body(complaintId)}</p>
            <div>
              <h3 className="font-medium mb-1">{strings.report.success.whatNextHeading}</h3>
              <ul className="list-disc list-inside text-sm text-black/70 dark:text-white/70 flex flex-col gap-1">
                {strings.report.success.whatNext.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-4 text-sm">
              {office && (
                <Link href={`/office/${office.id}`} className="underline">
                  {strings.report.success.backToOffice}
                </Link>
              )}
              <Link href="/transparency" className="underline">
                {strings.report.success.viewTransparency}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
