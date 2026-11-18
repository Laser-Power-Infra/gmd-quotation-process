"use client";

import Link from "next/link";
import { InspectionReportsPage } from "@gmd/inspection-reports/ui";
import type { InspectionReportsActions } from "@gmd/inspection-reports/columns";

/**
 * Host wrapper: hands the package next/link (a server page cannot pass it to a client component),
 * so opening a report and coming back keeps the list's filters in the store.
 */
export default function InspectionReportsList({ actions }: { actions: InspectionReportsActions }) {
  return <InspectionReportsPage actions={actions} linkAs={Link} />;
}
