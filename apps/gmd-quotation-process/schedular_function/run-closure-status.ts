/**
 * Scheduled job — Closure Status sync.
 *
 * Single step: `syncClosureStatuses()` (`lib/closureStatusSync.ts`). It used to
 * run on every dashboard render; the full thread scan (regex over OCR text and
 * mail bodies) starved the DB pool and caused 503s, so it now runs here only.
 *
 * Writes `Enquiry.closureStatus` per `decideClosureStatus`: mail evidence turns
 * blank / Pending / Not Sent into Sent; a docket no thread references turns
 * blank into Pending. Sent, Rejected and Not Sent are never downgraded.
 *
 * Run by ofelia on `@every 10m`. Reads `docket_quotation_threads` and
 * `enquiries`; each write is guarded on the value read, so a manual save made
 * during the run is kept.
 */

import { syncClosureStatuses, type ClosureStatusSyncResult } from "@/lib/closureStatusSync";
import { JobAlreadyRunningError } from "./run-gmd-update";

export type JobName = "closure-status";

export type ScheduledClosureStatusResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    sync?: Omit<ClosureStatusSyncResult, "sentDockets" | "pendingDockets">;
  };
};

const inFlight = new Set<JobName>();

export async function runScheduledClosureStatus(): Promise<ScheduledClosureStatusResult> {
  const job: JobName = "closure-status";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledClosureStatusResult["steps"] = {};

  try {
    console.log(`\n########## [SCHEDULER] ${job} start ${startedAt} ##########`);

    // Docket lists are only dashboard styling hints; keep the response small.
    const { sentDockets: _s, pendingDockets: _p, ...sync } = await syncClosureStatuses();
    steps.sync = sync;

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `scanned=${sync.scanned} updated=${sync.updated} ` +
        `sent=${sync.sent} pending=${sync.pending} threads=${sync.threadCount}`,
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);

    return { success: true, job, startedAt, elapsedMs, steps };
  } finally {
    // Always release, so a throw cannot wedge the next run.
    inFlight.delete(job);
  }
}
