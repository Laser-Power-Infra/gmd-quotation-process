/**
 * Scheduled job registry — one entry per ofelia-driven sync.
 *
 * Each job is a sequential pipeline of steps. `gmd-update` runs:
 *
 *   1. `runGmdCatalogueSync()`      GMD UPDATION -> RawMaterial (create + diff)
 *   2. `runStockPhysSync()`         stock-phys   -> RawMaterial.availableStock
 *   3. `runRawMaterialItemNameSync()` ITEM MASTER ERP -> RawMaterial.itemNameAuto
 *   4. `runActiveBomRules()`        active Auto BOM rules -> Bom / BomItem
 *   5. `syncRmDrawings()`           RM drawing map sheet -> RawMaterial.drawingUrl
 *
 * Step 2 only makes sense once step 1 has landed, so the steps are strictly
 * sequential: a fatal failure in step 1 aborts before step 2 runs rather than
 * refreshing stock against a half-synced table. Step 3 fills `itemNameAuto`,
 * which step 1 no longer owns (it is excluded from NON_EDITABLE_FIELDS).
 * Step 5 is display-only, so its failure lands in `warnings` instead of failing
 * the job (raw-material-sync.sh does not check `warnings`).
 *
 * All logic lives in this folder. `app/api/scheduler/**` contains nothing but
 * thin HTTP shims, because Next.js only routes `route.ts` files that sit under
 * `app/`.
 *
 * No module here imports from `@/app/actions` — that file is a `"use server"`
 * module and a route handler must not reach into one.
 */

import { runGmdCatalogueSync, type CatalogueSyncResult } from "./gmd-update-catalogue";
import {
  runStockPhysSync,
  type StockPhysSyncOptions,
  type StockPhysSyncResult,
} from "./gmd-update-stock-phys";
import { runRawMaterialItemNameSync, type ItemNameSyncResult } from "./item-name-sync";
import { recordJobRun } from "./job-heartbeat";
import { JobAlreadyRunningError } from "./job-latch";
import { runActiveBomRules } from "@/lib/autoBomRun";
import { syncRmDrawings, type RmDrawingSyncResult } from "@/lib/gmd_lib/rmDrawings";

// Lives in job-latch.ts now; re-exported so every `from "./run-gmd-update"` import keeps working.
export { JobAlreadyRunningError };

export type JobName = "gmd-update";

export type ScheduledJobResult = {
  success: boolean;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  steps: {
    catalogue?: CatalogueSyncResult;
    stock?: StockPhysSyncResult;
    itemNames?: ItemNameSyncResult;
    autoBom?: { created: number; failed: number };
    drawings?: RmDrawingSyncResult;
  };
  /** Steps that failed without failing the job (step 5). */
  warnings: string[];
};

export type ScheduledJobError = {
  success: false;
  job: JobName;
  startedAt: string;
  elapsedMs: number;
  error: string;
  /** Whatever completed before the failure. */
  steps: ScheduledJobResult["steps"];
};

/**
 * In-process latch. Ofelia's `no-overlap = true` only stops ofelia jobs from
 * colliding with each other — it cannot stop a manual Sync button click (or a
 * second app instance sharing one database) from overlapping this run. A
 * second concurrent caller is rejected rather than queued.
 */
const inFlight = new Set<JobName>();

export type RunGmdUpdateOptions = {
  /** Forwarded to step 2 so a caller can preview without writing. */
  dryRunStock?: boolean;
  concurrency?: number;
};

/**
 * Runs the Raw Material scheduled sync end to end.
 *
 * Throws `JobAlreadyRunningError` if this job is already in flight; throws
 * whatever step 1 or step 2 threw on a fatal error. Callers translate that
 * into an HTTP status.
 */
export async function runScheduledGmdUpdate(
  options: RunGmdUpdateOptions = {},
): Promise<ScheduledJobResult> {
  const job: JobName = "gmd-update";

  if (inFlight.has(job)) {
    throw new JobAlreadyRunningError(job);
  }
  inFlight.add(job);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: ScheduledJobResult["steps"] = {};
  const warnings: string[] = [];

  try {
    console.log(
      `\n########## [SCHEDULER] ${job} start ${startedAt} ##########`,
    );

    // Step 1 — catalogue. A throw here skips step 2 entirely.
    steps.catalogue = await runGmdCatalogueSync(options.concurrency);

    // Step 2 — physical stock refresh.
    const stockOptions: StockPhysSyncOptions = {
      dryRun: options.dryRunStock ?? false,
    };
    if (options.concurrency !== undefined) {
      stockOptions.concurrency = options.concurrency;
    }
    steps.stock = await runStockPhysSync(stockOptions);

    // Step 3 — item names from ITEM MASTER ERP -> RawMaterial.itemNameAuto.
    steps.itemNames = await runRawMaterialItemNameSync();

    // Step 4 — active Auto BOM rules against the refreshed raw materials.
    // Never throws; a failing rule is logged and counted.
    steps.autoBom = await runActiveBomRules(job);

    // Step 5 — drawing links from Puja's RM drawing map. Isolated: a sheet or
    // write error is reported, never fails the job or voids steps 1-4.
    try {
      steps.drawings = await syncRmDrawings();
    } catch (err) {
      const message = `drawings: ${err instanceof Error ? err.message : "Unknown error"}`;
      console.error(`[scheduler] ${job} step 5 failed: ${message}`);
      warnings.push(message);
    }

    const elapsedMs = Date.now() - startedAtMs;

    console.log(
      `[scheduler] ${job} finished in ${elapsedMs}ms — ` +
        `catalogue(created=${steps.catalogue.created}, updated=${steps.catalogue.updated}, unchanged=${steps.catalogue.unchanged}) ` +
        `stock(updated=${steps.stock.updatedRows}, changed=${steps.stock.changed}) ` +
        `itemNames(updated=${steps.itemNames.updated}, unmatched=${steps.itemNames.unmatched}) ` +
        `autoBom(created=${steps.autoBom.created}, failed=${steps.autoBom.failed}) ` +
        (steps.drawings
          ? `drawings(updated=${steps.drawings.updated}, notInRm=${steps.drawings.notInRm.length})`
          : "drawings(FAILED, see warnings)"),
    );
    console.log(`########## [SCHEDULER] ${job} done ##########\n`);
    // Scheduled (conf + route) as raw-material; gmd-update is only its internal name.
    if (!options.dryRunStock) await recordJobRun("raw-material", steps.catalogue.totalInSheet);

    return {
      success: true,
      job,
      startedAt,
      elapsedMs,
      steps,
      warnings,
    };
  } finally {
    // Always release, so a throw does not wedge the next hourly run.
    inFlight.delete(job);
  }
}