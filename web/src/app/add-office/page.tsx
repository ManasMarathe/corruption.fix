import type { Metadata } from "next";
import { AddOfficeClient } from "@/components/add-office/AddOfficeClient";
import { getSession } from "@/lib/session";
import { strings } from "@/lib/strings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${strings.addOffice.title} — ${strings.app.name}`,
};

export default async function AddOfficePage() {
  const session = await getSession();
  return <AddOfficeClient initiallyAuthenticated={!!session} />;
}
