"use server";
import { requireAccess, loginRequired } from "@/lib/access";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  GATED_STATUSES,
  REPORT_STATUSES,
  checkReport,
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
