import { Suspense } from "react";
import type { Metadata } from "next";
import { strings } from "@/lib/strings";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: `${strings.report.meta.title} — ${strings.app.name}`,
};

// ReportForm reads the `office` query param via useSearchParams, which
// requires a Suspense boundary in the App Router.
export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportForm />
    </Suspense>
  );
}
