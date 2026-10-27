import "server-only";
import { columnAccess } from "@gmd/contract-review/flags";
import type { ActionResult } from "@gmd/contract-review/types";
import {
  ACTUATOR_IDX,
  BOM_ID_IDX,
  CLEARANCE_STATUS_IDX,
  CONTRACT_NO_IDX,
  MC_IDX,
} from "@gmd/contract-review/view";
import {
  getContractReviewDataset,
  invalidateContractReviewCache,
} from "@/lib/contractReviewView";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { autoAssignContractReviewBomIdFromActuator, backfillContractReviewCostFromQuotationAction, backfillContractReviewNoUseBatchAction, selectContractReviewBomIdAction, syncContractReviewEnquiryFieldsBatchAction } from "@/app/actions/contractReview";
import {
  backfillContractReviewClearanceMcPendingBatchAction,
  backfillContractReviewInspectionBatchAction,
  backfillContractReviewOfferPendingDoneBatchAction,
  backfillContractReviewPnRatingBatchAction,
} from "@/app/contract_review/actions";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

// The derived columns (RM AVAIL, STATE / UTILITY, OFFER / INSPECTION, PN RATING,
// BOM ID defaults ...) are filled by idempotent batch actions that persist what
// they compute. They used to be fired from the browser, one request per
// column, over every row on every page open. Run them here instead, one run at
// a time and not more than once a minute.
const BACKFILL_MIN_INTERVAL_MS = 60_000;
let backfillRunning: Promise<ActionResult> | null = null;
let backfillFinishedAt = 0;

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function backfillAll(): Promise<ActionResult> {
  const flags = await getContractReviewFlags();
  const { isEnabled, isEditable } = columnAccess(flags);
  // The backfills are idempotent, so the cached rows are good enough; a stale
  // copy only means a few redundant writes, not wrong ones.
  const { data, bomIdOptions } = await getContractReviewDataset();
  const { rows, ids } = data;

  const blank = (row: unknown[], idx: number) =>
    idx === -1 || String(row[idx] ?? "").trim() === "";

  const tasks: Promise<unknown>[] = [];

  if (isEditable("BOM ID")) {
    const single: { id: string; bomId: string }[] = [];
    const fromActuator: string[] = [];
    rows.forEach((row, i) => {
      const id = ids[i];
      const options = bomIdOptions[id];
      if (!id || !options || options.length === 0) return;
      if (options.length === 1) {
        if (String(row[BOM_ID_IDX] ?? "").trim() !== options[0])
          single.push({ id, bomId: options[0] });
        return;
      }
      const actuator = ACTUATOR_IDX !== -1 ? String(row[ACTUATOR_IDX] ?? "") : "";
      if (actuator.includes("@")) fromActuator.push(id);
    });
    tasks.push(
      inChunks(single, 10, ({ id, bomId }) => selectContractReviewBomIdAction(id, bomId)),
    );
    if (fromActuator.length)
      tasks.push(autoAssignContractReviewBomIdFromActuator(fromActuator));
  }

  if (isEnabled("RM AVAIL")) {
    const withBom = ids.filter((_, i) => !blank(rows[i], BOM_ID_IDX));
    if (withBom.length) tasks.push(backfillContractReviewNoUseBatchAction(withBom));
  }
  if (isEnabled("VA % FROM COST")) {
    const withContract = ids.filter((_, i) => !blank(rows[i], CONTRACT_NO_IDX));
    if (withContract.length)
      tasks.push(backfillContractReviewCostFromQuotationAction(withContract));
  }
  if (["STATE", "UTILITY", "PROJECT REFERENCE"].some(isEnabled)) {
    tasks.push(syncContractReviewEnquiryFieldsBatchAction(ids));
  }
  // These wrappers re-check the column flags themselves.
  tasks.push(backfillContractReviewOfferPendingDoneBatchAction(ids));
  tasks.push(backfillContractReviewInspectionBatchAction(ids));
  tasks.push(backfillContractReviewPnRatingBatchAction(ids));
  const needsClearanceMc = ids.filter((_, i) => {
    const row = rows[i];
    const clearance =
      CLEARANCE_STATUS_IDX === -1
        ? ""
        : String(row[CLEARANCE_STATUS_IDX] ?? "").trim();
    return (
      clearance === "" ||
      (clearance.toUpperCase() === "PENDING" && clearance !== "PENDING") ||
      blank(row, MC_IDX)
    );
  });
  if (needsClearanceMc.length)
    tasks.push(backfillContractReviewClearanceMcPendingBatchAction(needsClearanceMc));

  const settled = await Promise.allSettled(tasks);
  const failed = settled.filter((s) => s.status === "rejected");
  for (const f of failed) console.error("contract review backfill failed", (f as PromiseRejectedResult).reason);
  invalidateContractReviewCache();
  return { success: true, data: { ran: true, failed: failed.length } };
}

export async function runContractReviewBackfills(): Promise<ActionResult> {
  if (backfillRunning) return backfillRunning;
  if (Date.now() - backfillFinishedAt < BACKFILL_MIN_INTERVAL_MS)
    return { success: true, data: { ran: false } };
  backfillRunning = backfillAll()
    .catch((error): ActionResult => ({ success: false, error: errorMessage(error) }))
    .finally(() => {
      backfillFinishedAt = Date.now();
      backfillRunning = null;
    });
  return backfillRunning;
}
