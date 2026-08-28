"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddOfficeMap } from "@/components/map/AddOfficeMap";
import { CATEGORY_LIST } from "@/lib/categories";
import { strings } from "@/lib/strings";
import type { OfficeCategory } from "@/db/schema";

interface ErrorBody {
  error?: { code: string; message: string };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return body?.error?.message ?? fallback;
}

// ~180k offices are about to land via bulk import, so the client-side check
// below is a soft, best-effort nudge, not the source of truth — the server
// (POST /api/offices) makes its own, stricter same-category+near-name check.
const DUPLICATE_RADIUS_M = 100;

interface NearbyOffice {
  id: string;
  name: string;
  category: OfficeCategory;
  lat: number;
  lng: number;
}

/** Great-circle distance in meters. Good enough at this scale (~100m checks). */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** A small bbox around (lat, lng), wide enough to contain everything within `meters`. */
function bboxAround(lat: number, lng: number, meters: number): string {
  const latDelta = meters / 111_320;
  const lngDelta = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta].join(",");
}

/**
 * Best-effort same-category-nearby check for the client-side warning.
 *
 * Reuses GET /api/offices?bbox=, which only returns `source = 'user'`
 * offices (see the comment on that route) — so this cannot see the OSM or
 * bulk-imported (indiapost/uidai/parivahan/ecourts/police) offices that make
 * up the vast majority of the map. That's a known gap: it catches duplicate
 * *user* submissions, not duplicates of imported data. Any failure here is
 * swallowed — a broken check should never block a legitimate submission.
 */
async function findNearbyDuplicate(
  lat: number,
  lng: number,
  category: OfficeCategory
): Promise<string | null> {
  try {
    const bbox = bboxAround(lat, lng, DUPLICATE_RADIUS_M);
    const res = await fetch(`/api/offices?bbox=${encodeURIComponent(bbox)}`);
    if (!res.ok) return null;
    const body: { offices: NearbyOffice[] } = await res.json();
    const match = body.offices.find(
      (o) =>
        o.category === category &&
        haversineMeters(lat, lng, o.lat, o.lng) <= DUPLICATE_RADIUS_M
    );
    return match?.name ?? null;
  } catch {
    return null;
  }
}

function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, strings.auth.errors.serverError));
        return;
      }
      setStep("code");
    } catch {
      setError(strings.auth.errors.serverError);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, strings.auth.errors.serverError));
        return;
      }
      onAuthenticated();
    } catch {
      setError(strings.auth.errors.serverError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm flex flex-col gap-4">
      <p className="text-black/70 dark:text-white/70">{strings.addOffice.loginRequired}</p>

      {step === "email" ? (
        <form onSubmit={submitEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {strings.addOffice.loginEmailLabel}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={strings.addOffice.loginEmailPlaceholder}
              className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? strings.addOffice.loginSending : strings.addOffice.loginSendCode}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <p className="text-sm text-black/60 dark:text-white/60">
            {strings.addOffice.loginCodeSent(email)}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            {strings.addOffice.loginCodeLabel}
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30 tracking-widest"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? strings.addOffice.loginVerifying : strings.addOffice.loginVerify}
          </button>
        </form>
      )}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

function AddOfficeForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<OfficeCategory>("other");
  const [address, setAddress] = useState("");
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  // Name of a likely-duplicate office found near the pin, or null if none
  // has been flagged (yet). Cleared whenever the pin or category changes, so
  // a stale warning never survives the user fixing the thing it was about.
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);

  useEffect(() => {
    setDuplicateName(null);
    setDuplicateConfirmed(false);
  }, [position, category]);

  async function postOffice() {
    const res = await fetch("/api/offices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        category,
        lat: position!.lat,
        lng: position!.lng,
        address: address.trim() || undefined,
      }),
    });
    if (!res.ok) {
      setError(await readErrorMessage(res, strings.addOffice.errors.serverError));
      return;
    }
    const body: { office: { id: string; name: string } } = await res.json();
    setCreated(body.office);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) {
      setError(strings.addOffice.errors.nameRequired);
      return;
    }
    if (!position) {
      setError(strings.addOffice.errors.locationRequired);
      return;
    }

    setBusy(true);
    try {
      if (!duplicateConfirmed) {
        const match = await findNearbyDuplicate(position.lat, position.lng, category);
        if (match) {
          // Surface the warning and stop short of submitting — the explicit
          // "Add it anyway" button (not this form submit) is what proceeds,
          // so a genuinely distinct nearby office never gets silently blocked.
          setDuplicateName(match);
          return;
        }
      }
      await postOffice();
    } catch {
      setError(strings.addOffice.errors.serverError);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDuplicateAndSubmit() {
    if (!position) return;
    setError(null);
    setDuplicateConfirmed(true);
    setBusy(true);
    try {
      await postOffice();
    } catch {
      setError(strings.addOffice.errors.serverError);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-black/80 dark:text-white/80">{strings.addOffice.success}</p>
        <div className="flex gap-3">
          <Link
            href={`/office/${created.id}`}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90"
          >
            {strings.addOffice.viewOfficeLink}
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setName("");
              setAddress("");
              setCategory("other");
              setPosition(null);
            }}
            className="rounded-md border border-black/15 dark:border-white/20 px-4 py-2.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
          >
            {strings.addOffice.addAnother}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-xl">
      <label className="flex flex-col gap-1 text-sm">
        {strings.addOffice.nameLabel}
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={strings.addOffice.namePlaceholder}
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {strings.addOffice.categoryLabel}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as OfficeCategory)}
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
        >
          {CATEGORY_LIST.map((c) => (
            <option key={c} value={c}>
              {strings.map.categories[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {strings.addOffice.addressLabel}
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={strings.addOffice.addressPlaceholder}
          className="rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/30"
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span>{strings.addOffice.pinInstructions}</span>
        <span className="text-xs text-black/50 dark:text-white/50">
          {strings.addOffice.existingNearby}
        </span>
        <AddOfficeMap onChange={(lat, lng) => setPosition({ lat, lng })} />
        {position ? (
          <span className="text-xs text-black/50 dark:text-white/50">
            {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
          </span>
        ) : null}
      </div>

      {duplicateName ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
          <p>{strings.addOffice.duplicateWarning(duplicateName)}</p>
          <button
            type="button"
            onClick={confirmDuplicateAndSubmit}
            disabled={busy}
            className="rounded-md border border-amber-600/40 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 w-fit"
          >
            {strings.addOffice.duplicateContinue}
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 w-fit"
      >
        {busy ? strings.addOffice.submitting : strings.addOffice.submit}
      </button>
    </form>
  );
}

export function AddOfficeClient({
  initiallyAuthenticated,
}: {
  initiallyAuthenticated: boolean;
}) {
  const [authenticated, setAuthenticated] = useState(initiallyAuthenticated);

  return (
    <main className="min-h-screen max-w-2xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-black/60 dark:text-white/60 hover:underline">
          {strings.office.backToMap}
        </Link>
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{strings.addOffice.title}</h1>
        <p className="text-black/70 dark:text-white/70">{strings.addOffice.intro}</p>
      </header>

      {authenticated ? (
        <AddOfficeForm />
      ) : (
        <AuthGate onAuthenticated={() => setAuthenticated(true)} />
      )}
    </main>
  );
}
