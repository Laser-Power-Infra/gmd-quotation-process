"use server";

import { requireAccess } from "@/lib/access";
import { JobAlreadyRunningError, runScheduledLedgerSync } from "@/schedular_function";

export type LedgerSyncActionResult =
  | { success: true; written: { debtors: number; creditors: number; advances: number } }
  | { success: false; error: string };

/**
 * Manual "Sync" on /debtors and /creditors. Same function as the 01:55 ofelia
 * job (same latch too, so a click during the scheduled run is refused, not doubled).
 */
export async function syncLedgerAction(): Promise<LedgerSyncActionResult> {
  await requireAccess();
  try {
    const { success, report } = await runScheduledLedgerSync();
    if (!success) {
      const failed = Object.entries(report)
        .filter(([, p]) => p.error)
        .map(([k, p]) => `${k}: ${p.error}`)
        .join("; ");
      // Healthy ledgers were still written; only the failed ones kept their old rows.
      return { success: false, error: `Sync failed for ${failed}` };
    }
    return {
      success: true,
      written: {
        debtors: report.debtors.written,
        creditors: report.creditors.written,
        advances: report.advances.written,
      },
    };
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return { success: false, error: "A ledger sync is already running — try again in a minute." };
    }
    return { success: false, error: err instanceof Error ? err.message : "Sync failed" };
  }
}
