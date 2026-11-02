/**
 * Scheduled job: ITEM MASTER ERP tab -> `ServiceItem` (quotation DB). The
 * Service / Work Orders page joins it on read (`lib/serviceOrders.ts`) with the
 * stock DB's `PurchaseOrderLine` and `GrnLine`, which the purchase-orders job
 * already mirrors — so PO and GRN lines are not copied twice.
 *
 * Snapshot copy like `ledger-sync.ts`: the table is replaced in one transaction,
 * so a renamed tab or column leaves it as it was. A failure is reported on
 * `error`, never thrown.
 * No `@/app/actions` import.
 */

import { JobAlreadyRunningError } from "./run-gmd-update";
import { ITEM_MASTER_GID, serviceItemsFrom } from "@/lib/serviceOrders";

export type ServiceOrdersPartReport = { read: number; written: number; skipped: number; inDb: number; error?: string };
export type ServiceOrdersSyncReport = {
  serviceItems: ServiceOrdersPartReport;
};

const CHUNK = 500;
const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

function sheetId(): string {
  const id = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!id) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");
  return id;
}

export async function runServiceOrdersSync(opts: { dryRun?: boolean } = {}): Promise<ServiceOrdersSyncReport> {
  const dryRun = opts.dryRun ?? false;
  const { prisma } = await import("@/lib/prisma");
  const { readSheetTabByGid } = await import("@/lib/gmd_lib/bomMastErp");

  // Delete runs first inside the transaction, so a failed insert leaves the table as it was.
  const part = async <T>(
    gid: number,
    map: (tab: Awaited<ReturnType<typeof readSheetTabByGid>>) => { records: T[]; skipped: number },
    count: () => Promise<number>,
    replace: (rows: T[]) => Promise<unknown>,
  ): Promise<ServiceOrdersPartReport> => {
    const r: ServiceOrdersPartReport = { read: 0, written: 0, skipped: 0, inDb: 0 };
    try {
      const tab = await readSheetTabByGid(sheetId(), gid);
      const { records, skipped } = map(tab); // throws on a renamed column, before any write
      r.read = tab.rows.length;
      r.skipped = skipped;
      r.inDb = await count();
      if (!dryRun) {
        await replace(records);
        r.written = records.length;
      }
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
    return r;
  };

  const serviceItems = await part(
    ITEM_MASTER_GID,
    (tab) => {
      const records = serviceItemsFrom(tab);
      return { records, skipped: tab.rows.length - records.length };
    },
    () => prisma.serviceItem.count(),
    (rows) => prisma.$transaction([prisma.serviceItem.deleteMany(), ...chunks(rows).map((data) => prisma.serviceItem.createMany({ data }))]),
  );
  return { serviceItems };
}

export type ScheduledServiceOrdersResult = {
  success: boolean;
  job: "service-orders";
  startedAt: string;
  elapsedMs: number;
  report: ServiceOrdersSyncReport;
};

// shortcut: in-process latch only, blind to a second app replica; ofelia no-overlap covers the schedule, move to a DB advisory lock if the app is ever scaled out.
let inFlight = false;

/** Route entry. `success` is false when any table failed; healthy tables are still written. */
export async function runScheduledServiceOrders(options: { dryRun?: boolean } = {}): Promise<ScheduledServiceOrdersResult> {
  if (inFlight) throw new JobAlreadyRunningError("service-orders");
  inFlight = true;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  try {
    console.log(`\n########## [SCHEDULER] service-orders start ${startedAt} ##########`);
    const report = await runServiceOrdersSync({ dryRun: options.dryRun ?? false });
    const elapsedMs = Date.now() - startedAtMs;
    for (const [k, p] of Object.entries(report)) {
      console.log(`[scheduler] service-orders ${k}: read=${p.read} written=${p.written} skipped=${p.skipped}` + (p.error ? ` ERROR=${p.error}` : ""));
    }
    console.log(`########## [SCHEDULER] service-orders done in ${elapsedMs}ms ##########\n`);
    return { success: Object.values(report).every((p) => !p.error), job: "service-orders", startedAt, elapsedMs, report };
  } finally {
    inFlight = false;
  }
}
