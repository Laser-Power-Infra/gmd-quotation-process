"use server";
import { requireAccess, loginRequired } from "@/lib/access";

import { revalidatePath } from "next/cache";
import { listInspectionFacet, listInspectionPage } from "@gmd/inspection-reports/server";
import type { InspectionPageData } from "@gmd/inspection-reports/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { prisma } from "@/lib/prisma";
import {
  GATED_STATUSES,
  REPORT_STATUSES,
  checkReport,
  cleanTeam,
  type ReportData,
  type ReportStatus,
} from "@/lib/inspectionReport";

export type SaveReportResult = { success: true } | { success: false; error: string };

export async function saveInspectionReportAction(
  id: string,
  status: string,
  data: ReportData,
): Promise<SaveReportResult> {
  await requireAccess();
  const denied = await loginRequired();
  if (denied) return denied;

  if (!REPORT_STATUSES.includes(status as ReportStatus)) {
    return { success: false, error: `Unknown status "${status}"` };
  }
  // Client input: a malformed team would crash checkReport here and the list page once saved.
  data = { ...data, team: cleanTeam(data.team) };
  if (GATED_STATUSES.includes(status as ReportStatus)) {
    const failing = checkReport(data).filter((c) => !c.ok);
    if (failing.length) {
      return {
        success: false,
        error: `Cannot set "${status}" — failing checks: ${failing.map((c) => c.label).join("; ")}`,
      };
    }
  }

  try {
    await prisma.inspectionReport.update({ where: { id }, data: { status, data } });
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Save failed" };
  }
  revalidatePath("/inspection_reports");
  return { success: true };
}

type Result<T> = { success: true; data: T } | { success: false; error: string };

// The list is read-only; the package rejects any column key it does not list.
async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(query: TableQuery): Promise<Result<InspectionPageData>> {
  return guarded(async () => {
    await requireAccess();
    return listInspectionPage(query);
  });
}

export async function loadFacet(key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listInspectionFacet(key, query);
  });
}
