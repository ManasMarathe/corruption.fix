import type { Metadata } from "next";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { chainCheckpoints, chainEntries } from "@/db/schema";
import { env } from "@/lib/env";
import { strings } from "@/lib/strings";
import { VerifyBox } from "./VerifyBox";

export const metadata: Metadata = {
  title: `${strings.transparency.meta.title} — ${strings.app.name}`,
};

export const dynamic = "force-dynamic";

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function TransparencyPage() {
  const [checkpoints, tombstones] = await Promise.all([
    db
      .select({
        id: chainCheckpoints.id,
        fromSeq: chainCheckpoints.fromSeq,
        toSeq: chainCheckpoints.toSeq,
        headHash: chainCheckpoints.headHash,
        signature: chainCheckpoints.signature,
        createdAt: chainCheckpoints.createdAt,
      })
      .from(chainCheckpoints)
      .orderBy(desc(chainCheckpoints.toSeq))
      .limit(50),
    db
      .select({
        seq: chainEntries.seq,
        removedAt: chainEntries.removedAt,
        removalReason: chainEntries.removalReason,
        orderRef: chainEntries.orderRef,
      })
      .from(chainEntries)
      .where(isNotNull(chainEntries.removedAt))
      .orderBy(desc(chainEntries.seq))
      .limit(200),
  ]);

  const t = strings.transparency;

  return (
    <div className="font-sans min-h-screen flex flex-col items-center p-8">
      <div className="w-full max-w-3xl flex flex-col gap-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t.meta.title}</h1>
          <p className="text-black/70 dark:text-white/70">{t.intro}</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t.chain.heading}</h2>
          <p className="text-sm text-black/70 dark:text-white/70">{t.chain.body}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.checkpoints.heading}</h2>
          <p className="text-sm text-black/70 dark:text-white/70">{t.checkpoints.body}</p>

          <div className="text-sm">
            <span className="font-medium">{t.checkpoints.publicKeyLabel}: </span>
            {env.CHECKPOINT_PUBLIC_KEY ? (
              <code className="break-all">{env.CHECKPOINT_PUBLIC_KEY}</code>
            ) : (
              <span className="text-black/50 dark:text-white/50">{t.checkpoints.publicKeyMissing}</span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-black/15 dark:border-white/15 text-left">
                  <th className="py-2 pr-4">{t.checkpoints.colRange}</th>
                  <th className="py-2 pr-4">{t.checkpoints.colHead}</th>
                  <th className="py-2 pr-4">{t.checkpoints.colDate}</th>
                  <th className="py-2">{t.checkpoints.colSignature}</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-black/50 dark:text-white/50">
                      {t.checkpoints.empty}
                    </td>
                  </tr>
                )}
                {checkpoints.map((cp) => (
                  <tr key={cp.id} className="border-b border-black/5 dark:border-white/5">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {cp.fromSeq}–{cp.toSeq}
                    </td>
                    <td className="py-2 pr-4">
                      <code>{truncateHash(cp.headHash)}</code>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDate(cp.createdAt)}</td>
                    <td className="py-2">
                      <code>{truncateHash(cp.signature)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.tombstones.heading}</h2>
          <p className="text-sm text-black/70 dark:text-white/70">{t.tombstones.body}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-black/15 dark:border-white/15 text-left">
                  <th className="py-2 pr-4">{t.tombstones.colSeq}</th>
                  <th className="py-2 pr-4">{t.tombstones.colDate}</th>
                  <th className="py-2 pr-4">{t.tombstones.colReason}</th>
                  <th className="py-2">{t.tombstones.colOrderRef}</th>
                </tr>
              </thead>
              <tbody>
                {tombstones.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-black/50 dark:text-white/50">
                      {t.tombstones.empty}
                    </td>
                  </tr>
                )}
                {tombstones.map((ts) => (
                  <tr key={ts.seq} className="border-b border-black/5 dark:border-white/5">
                    <td className="py-2 pr-4">{ts.seq}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {ts.removedAt ? formatDate(ts.removedAt) : ""}
                    </td>
                    <td className="py-2 pr-4">{ts.removalReason}</td>
                    <td className="py-2">{ts.orderRef ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <VerifyBox />
      </div>
    </div>
  );
}
