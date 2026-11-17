import "server-only";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { MAIL_DOCS_COLUMN, type MailDocCategory } from "@gmd/contract-review/columns";
import { columnAccess } from "@gmd/contract-review/flags";
import type { ActionResult } from "@gmd/contract-review/types";
import {
  ACTUATOR_IDX,
  BOM_ID_IDX,
  CLEARANCE_STATUS_IDX,
  CONTRACT_NO_IDX,
  MC_IDX,
} from "@gmd/contract-review/view";
import { applyColumnFlags, loadContractReviewItems, toContractReviewData } from "@gmd/contract-review/server";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { mailTagDay } from "@/lib/contractReviewLinks";
import { autoAssignContractReviewBomIdFromActuator, backfillContractReviewCostFromQuotationAction, backfillContractReviewNoUseBatchAction, selectContractReviewBomIdAction, syncContractReviewEnquiryFieldsBatchAction } from "@/app/actions/contractReview";
import {
  backfillContractReviewClearanceMcPendingBatchAction,
  backfillContractReviewInspectionBatchAction,
  backfillContractReviewOfferPendingDoneBatchAction,
  backfillContractReviewPnRatingBatchAction,
} from "@/app/contract_review/actions";

// The derived columns (RM AVAIL, STATE / UTILITY, OFFER / INSPECTION, PN RATING,
// BOM ID defaults ...) are filled by idempotent batch actions that persist what
// they compute. They used to run on every page open; they now run only as step 7
// of the hourly contract-review scheduler job (schedular_function/run-contract-review.ts).

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function runContractReviewBackfills(): Promise<ActionResult<{ failed: number }>> {
  const startedAt = Date.now();
  const flags = await getContractReviewFlags();
  const { isEnabled, isEditable } = columnAccess(flags);
  // This job works on every row, so it is the one place that still loads the whole table.
  const items = await loadContractReviewItems();
  const { rows, ids, headers } = applyColumnFlags(toContractReviewData(items), flags);
  const bomIdsByCode = await getBatchDistinctBomIds(items.map((i) => i.itemCode));
  const bomIdOptions: Record<string, string[]> = {};
  for (const item of items) bomIdOptions[item.id] = bomIdsByCode.get(item.itemCode) ?? [];

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
  // MC DATE / APPROVAL DATE from the mail tags. `where: null` re-checks the DB cell, so a date
  // typed after these cached rows were read is never overwritten.
  // shortcut: a newly added tag's date appears after the next hourly scheduler run, not at once;
  // fill it in addContractMailDoc too if that lag bothers anyone.
  const mailDocsIdx = headers.indexOf(MAIL_DOCS_COLUMN);
  const tagDays = (header: string, tag: MailDocCategory) => {
    const idx = headers.indexOf(header);
    if (!isEnabled(header)) return [];
    return ids.flatMap((id, i) => {
      const day = mailTagDay(rows[i][idx], rows[i][mailDocsIdx], tag);
      return day ? [{ id, day }] : [];
    });
  };
  tasks.push(
    inChunks(tagDays("MC DATE", "MC"), 10, ({ id, day }) =>
      tenderPrisma.contractReview.updateMany({ where: { id, mcDate: null }, data: { mcDate: day } }),
    ),
    inChunks(tagDays("APPROVAL DATE", "Drawing approval"), 10, ({ id, day }) =>
      tenderPrisma.contractReview.updateMany({ where: { id, approvalDate: null }, data: { approvalDate: day } }),
    ),
  );
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
  // Most batch actions catch their own errors and return { success: false }, so count those too.
  const softFailed = settled.filter(
    (s) => s.status === "fulfilled" && (s.value as ActionResult | undefined)?.success === false,
  );
  const summary = `${new Date().toISOString()} [contract-review backfill] ${rows.length} rows, ${tasks.length} tasks in ${Date.now() - startedAt} ms`;
  if (failed.length || softFailed.length) {
    const reasons = softFailed.map((s) => (s as PromiseFulfilledResult<ActionResult>).value.error).join(" | ");
    console.error(`${summary}: ${failed.length} threw, ${softFailed.length} returned errors${reasons ? ` (${reasons})` : ""}`);
  } else {
    console.info(`${summary}: ok`);
  }
  return { success: true, data: { failed: failed.length + softFailed.length } };
}
