/**
 * Scheduled job — Supply History MASTER sync, then the sale-bill rate backfill.
 *
 * Two steps, in order: `runSupplyHistorySync()`, then `runSupplyRateBackfill()`
 * (overwrite of `rate`, `value = quantity x rate`, and gross total =
 * `value x 1.18`). It must run second: MASTER still writes both fields on
 * INSERT, and `value` / `grossTotalInvoiceValue` sit in `SYNC_EXCLUDED_FIELDS`
 * so an update never fights this step.
 *
 * It still owns an in-flight latch: ofelia's `no-overlap = true` cannot see a
 * user clicking the manual Sync button, and the two would interleave writes over
 * the same table.
 *
 * Scheduled at :15, between `raw-material` (:00) and `contract-review` (:30).
 */

import { runSupplyHistorySync, type SupplyHistorySyncResult } from "./supply-history-sync";
import { JobAlreadyRunningError } from "./run-gmd-update";
import {
  runSupplyRateBackfill,
  type SupplyRateBackfillResult,
} from "@/lib/supplyRateBackfill";

export type JobName = "supply-history";

export type ScheduledSupplyHistoryResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    masterSync?: SupplyHistorySyncResult;
    /**
     * Overwrite of `rate` (from the sale-bill tab), `value = quantity x rate`
     * and the gross total (`value x 1.18`).
     */
    rateBackfill?: SupplyRateBackfillResult;
  };
  /** Set when the rate backfill failed; the MASTER sync still stands. */
  rateBackfillError?: string;
};

const inFlight = new Set<JobName>();

/**
 * Runs the Supply History MASTER sync.
 *
 * Throws `JobAlreadyRunningError` when already in flight; rethrows whatever the
 * step threw on a fatal error.
 */
export async function runScheduledSupplyHistory(): Promise<ScheduledSupplyHistoryResult> {
  const job: JobName = "supply-history";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledSupplyHistoryResult["steps"] = {};
  let rateBackfillError: string | undefined;

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    steps.masterSync = await runSupplyHistorySync();

    // Recomputes `rate` / `value` / gross total. A failure here must not undo
    // the row sync, so it is reported rather than thrown — the summary log
    // makes it visible.
    try {
      steps.rateBackfill = await runSupplyRateBackfill({ overwrite: true });
    } catch (err) {
      rateBackfillError = err instanceof Error ? err.message : "Unknown error";
      console.error("[scheduler] supply-history rate backfill failed:", err);
    }

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `inserted=${steps.masterSync.inserted} patched=${steps.masterSync.patched} ` +
        `touched=${steps.masterSync.touched} failedWrites=${steps.masterSync.failedWrites}`,
    );
    if (rateBackfillError) {
      console.error(`[scheduler] ${job} rate backfill FAILED: ${rateBackfillError}`);
    } else if (steps.rateBackfill) {
      console.log(
        `[scheduler] ${job} rate backfill — rateFilled=${steps.rateBackfill.rateFilled} ` +
          `valueFilled=${steps.rateBackfill.valueFilled} ` +
          `grossFilled=${steps.rateBackfill.grossFilled} ` +
          `unmatchedGroups=${steps.rateBackfill.groupsUnmatched} ` +
          `failedWrites=${steps.rateBackfill.failedWrites}`,
      );
    }
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps, rateBackfillError };
  } finally {
    // Always release, so a throw cannot wedge the next hourly run.
    inFlight.delete(job);
  }
}