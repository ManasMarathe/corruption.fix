import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewCountPing } from "@/components/ViewCountPing";
import { CATEGORY_COLORS } from "@/lib/categories";
import {
  getOfficeById,
  getOfficeStats,
  getPublishedComplaints,
  getPublishedOfficers,
  type PublishedComplaint,
  type PublishedOfficer,
} from "@/lib/offices";
import { strings } from "@/lib/strings";
import { isValidId } from "@/lib/uuid";

// office_stats (and everything else on this page) changes at most a few
// times a day via the refresh-stats/moderation jobs, so a 5-minute ISR
// window keeps the page cheap without serving noticeably stale data.
export const revalidate = 300;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isValidId(id)) return { title: strings.app.name };
  const office = await getOfficeById(id);
  if (!office) return { title: strings.app.name };
  return { title: `${office.name} — ${strings.app.name}` };
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

function OfficerCard({ officer }: { officer: PublishedOfficer }) {
  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="font-medium">
        {officer.name}
        {officer.designation ? (
          <span className="text-black/60 dark:text-white/60 font-normal">
            {" "}
            — {officer.designation}
          </span>
        ) : null}
      </div>
      {officer.replyText ? (
        <p className="text-sm text-black/70 dark:text-white/70 mt-2">{officer.replyText}</p>
      ) : null}
    </li>
  );
}

function ComplaintCard({ complaint }: { complaint: PublishedComplaint }) {
  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
        {complaint.publicMonth ? <span>{complaint.publicMonth}</span> : null}
        <span>{complaint.serviceType}</span>
        {complaint.bribeAmount != null ? <span>{formatInr(complaint.bribeAmount)}</span> : null}
      </div>
      <p className="text-sm whitespace-pre-wrap">{complaint.narrative}</p>
    </li>
  );
}

export default async function OfficePage({ params }: PageProps) {
  const { id } = await params;
  if (!isValidId(id)) notFound();

  const office = await getOfficeById(id);
  if (!office) notFound();

  const [stats, officers, complaintList] = await Promise.all([
    getOfficeStats(id),
    getPublishedOfficers(id),
    getPublishedComplaints(id),
  ]);

  const categoryLabel = strings.map.categories[office.category];
  const categoryColor = CATEGORY_COLORS[office.category];
  const hasStats = !!stats && stats.complaintCount > 0;

  const mapLinkParams = new URLSearchParams({
    lat: String(office.lat),
    lng: String(office.lng),
    zoom: "16",
    id: office.id,
    name: office.name,
    category: office.category,
  });

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6 flex flex-col gap-10">
      <ViewCountPing officeId={id} />

      <nav>
        <Link
          href="/"
          className="text-sm text-black/60 dark:text-white/60 hover:underline"
        >
          {strings.office.backToMap}
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <span
          className="inline-flex items-center gap-2 text-sm font-medium w-fit"
          style={{ color: categoryColor }}
        >
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: categoryColor }}
            aria-hidden
          />
          {categoryLabel}
        </span>
        <h1 className="text-3xl font-bold tracking-tight">{office.name}</h1>
        {office.address ? (
          <p className="text-black/70 dark:text-white/70">{office.address}</p>
        ) : null}
        <p className="text-sm text-black/50 dark:text-white/50">
          {office.lat.toFixed(5)}, {office.lng.toFixed(5)}{" "}
          <Link href={`/?${mapLinkParams.toString()}`} className="underline">
            {strings.office.viewOnMap}
          </Link>
        </p>
      </header>

      <section aria-label={strings.office.stats.complaintCount}>
        {hasStats && stats ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label={strings.office.stats.complaintCount} value={String(stats.complaintCount)} />
            <StatTile
              label={strings.office.stats.topService}
              value={stats.topService ?? "—"}
            />
            <StatTile
              label={strings.office.stats.medianBribe}
              value={stats.medianBribe != null ? formatInr(stats.medianBribe) : "—"}
            />
            <StatTile
              label={strings.office.stats.lastActivity}
              value={stats.lastMonth ?? "—"}
            />
          </div>
        ) : (
          <p className="text-black/60 dark:text-white/60">{strings.office.stats.noStatsYet}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{strings.office.officersTitle}</h2>
        {officers.length === 0 ? (
          <p className="text-black/60 dark:text-white/60">{strings.office.noOfficersYet}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {officers.map((officer) => (
              <OfficerCard key={officer.id} officer={officer} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{strings.office.complaintsTitle}</h2>
        {complaintList.length === 0 ? (
          <p className="text-black/60 dark:text-white/60">{strings.office.noComplaintsYet}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {complaintList.map((complaint) => (
              <ComplaintCard key={complaint.id} complaint={complaint} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <Link
          href={`/report?office=${office.id}`}
          className="inline-flex justify-center rounded-md bg-black text-white dark:bg-white dark:text-black px-5 py-3 font-medium hover:opacity-90 w-full sm:w-auto"
        >
          {strings.office.reportCta}
        </Link>
      </section>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{strings.office.fileOfficially.title}</h2>
        <p className="text-sm text-black/70 dark:text-white/70">
          {strings.office.fileOfficially.body}
        </p>
        <a
          href="https://pgportal.gov.in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline w-fit"
        >
          {strings.office.fileOfficially.link}
        </a>
        <p className="text-xs text-black/40 dark:text-white/40">
          {strings.office.fileOfficially.phaseNote}
        </p>
      </section>
    </main>
  );
}
