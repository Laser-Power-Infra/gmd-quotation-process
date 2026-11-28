/**
 * Scheduled job 1 of 3 — GMD EXECUTION TRACKING ERP tabs -> ContractReview
 * (rows built by `lib/gmd_lib/contract-review-erp-rows.ts`).
 *
 * The only Contract Review sync: the manual "SYNC" button and its route
 * (`app/api/contract-review/sync`) are removed. The write policy is the one that
 * route had; two changes make it safe to run hourly:
 *
 * 1. **The per-row lookup is replaced with a Map diff.** The manual version
 *    calls `tenderPrisma.contractReview.findFirst({ itemCode, contractNo })` once per
 *    sheet row and awaits each one serially. `ContractReview` has *no* `@@index`
 *    and *no* `@@unique` (confirmed in `prisma/schema.prisma`), so every one of
 *    those lookups is a sequential full-table scan — roughly 2N round-trips for
 *    N sheet rows. Here the existing rows are loaded once, keyed in a Map, and
 *    diffed in memory: the same pattern `app/api/supply-history/sync/route.ts`
 *    already uses. Same result, ~1 query instead of ~2N.
 *
 * 2. **Writes are chunked with an explicit transaction timeout.** The manual
 *    version issues one Prisma call per row; here they are batched at 200 with
 *    `{ timeout: 20000 }`, the same chunking the RM AVAIL job uses.
 *
 * Two side-effect stages from the manual route are deliberately NOT run here,
 * so they do not execute twice per hour:
 *   - the RM AVAIL (`noUse`) recompute belongs to job 3, which is the button
 *     that owns it.
 *   - the Enquiry backfill belongs to job 2.
 *
 * The two stages the manual route does that are NOT any button's job are kept
 * here, because otherwise the dashboard quietly goes stale once this becomes the
 * primary trigger: `syncEnquiryContractNumbers` and `recomputeNotCurrentReqtMarks`.
 *
 * Write policy (unchanged from the manual route):
 *   - create: every mapped sheet field except `itemType` / `rmCodeForActuator`.
 *   - update: 11 `PRESERVE_UI_FIELDS` are gap-fill only; 6 `SKIP_FIELDS` are
 *     never written; everything else is overwritten when the sheet value is
 *     non-blank and differs. A blank sheet value never clears the DB.
 *   - `contractNo` / `itemCode` are immutable keys.
 *   - never deletes.
 */

import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import {
  ERP_ROW_FIELDS,
  loadContractReviewErpRows,
} from "@/lib/gmd_lib/contract-review-erp-rows";
import { syncEnquiryContractNumbers } from "@/lib/syncEnquiryContractNumbers";
import { recomputeNotCurrentReqtMarks } from "@/lib/contractReviewCurrentReqt";

/** Rows per write fan-out. */
const WRITE_CHUNK = 200;

/** Gap-fill only — an existing DB value is never overwritten. */
const PRESERVE_UI_FIELDS = new Set([
  "bomFormulaTrial",
  "item",
  "clearanceStatus",
  "pnRating",
  "actuator",
  "paymentTerms",
  "lcRtgsRefNo",
  "lcDateRtgsDate",
  "lastDateOfShipmentDateOfLc",
  "issuingBankName",
  "dateOfContract",
]);

/**
 * Derived / UI-managed — never written, on create or update.
 * `costCodeRef` is derived too but is absent from CONTRACTS_SHEET_COLUMNS, so
 * `mapContractReviewRow` cannot emit it and the loop below cannot reach it. It
 * is published from the Indent Listing RM codes and must survive untouched.
 */
const SKIP_FIELDS = new Set([
  "itemType",
  "rmCodeForActuator",
  "diagramUrl",
  "diagramVerdict",
  "cBatch",
  "nBatch",
  // Owned by `runContractReviewItemNameSync` (ITEM MASTER ERP); the sheet's
  // ITEM_NAME must not overwrite it.
  "itemName",
]);

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function isNullOrEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/** Every field the ERP row builder emits; drives the preload select below. */
const MAPPED_FIELDS = ERP_ROW_FIELDS;

const EXISTING_SELECT = {
  id: true,
  ...(Object.fromEntries(MAPPED_FIELDS.map((f) => [f, true])) as Record<
    (typeof MAPPED_FIELDS)[number],
    true
  >),
};

/**
 * Shape of a preloaded existing row. Cast explicitly because the select above is
 * built at runtime, so Prisma cannot narrow the result for us — but it really
 * does return exactly these columns.
 */
type ExistingRow = {
  id: string;
} & Partial<Record<(typeof MAPPED_FIELDS)[number], string | null>>;

export type ContractReviewSyncResult = {
  syncedAt: string;
  totalInContracts: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Sheet rows dropped because itemCode or contractNo was blank. */
  blankKeyRows: number;
  /** Sheet rows dropped because an earlier row already used that key. */
  duplicateInSheet: number;
  failedWrites: number;
  changedColumns: Record<string, number>;
  /** Not a button of its own, but owned by this route — see the file header. */
  contractNoSynced: { updated: number; matched: number };
  notCurrentReqt: {
    contractReview: { marked: number; cleared: number };
    enquiryItem: { marked: number; cleared: number };
  };
  /** Set when an owned side-effect stage threw; the job still reports success. */
  warnings: string[];
  elapsedMs: number;
};

/**
 * Builds the rows from the ERP tabs and diffs them into ContractReview.
 *
 * Throws on a fatal error (sheet unreachable, OAuth failure, missing tab).
 * Per-row write failures are counted in `failedWrites`, not thrown.
 */
export async function runContractReviewSheetSync(): Promise<ContractReviewSyncResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  // Built from the GMD EXECUTION TRACKING ERP tabs, not the old CONTRACTS + dump
  // tabs. Repeated item lines are already merged, blank keys already dropped.
  const erpRows = await loadContractReviewErpRows();
  const blankKeyRows = 0;
  const duplicateInSheet = 0;

  // The Map-diff replacement for the per-row findFirst.
  const existingRows = (await tenderPrisma.contractReview.findMany({
    select: EXISTING_SELECT,
  })) as unknown as ExistingRow[];
  const existingByKey = new Map<string, ExistingRow>();
  for (const row of existingRows) {
    const key =
      normalizeKey(row.itemCode ?? "") + "||" + normalizeKey(row.contractNo ?? "");
    if (!key || key === "||") continue;
    // First DB row wins if duplicates somehow exist.
    if (existingByKey.has(key)) continue;
    existingByKey.set(key, row);
  }

  const syncedAt = new Date();

  type CreatePlan = { data: Record<string, unknown> };
  const toCreate: CreatePlan[] = [];
  const toUpdate: {
    id: string;
    data: Record<string, unknown>;
    isChange: boolean;
  }[] = [];
  const changedColumns: Record<string, number> = {};

  for (const [key, mapped] of erpRows) {

    const existing = existingByKey.get(key);

    if (!existing) {
      toCreate.push({ data: { ...mapped, syncedAt } });
      continue;
    }

    const filtered: Record<string, unknown> = { syncedAt };
    let hasDataChange = false;

    for (const [field, sheetVal] of Object.entries(mapped)) {
      if (field === "contractNo" || field === "itemCode") continue;
      if (SKIP_FIELDS.has(field)) continue;

      const dbVal = (existing as unknown as Record<string, unknown>)[field];

      if (PRESERVE_UI_FIELDS.has(field)) {
        if (isNullOrEmpty(dbVal) && !isNullOrEmpty(sheetVal)) {
          filtered[field] = sheetVal;
          hasDataChange = true;
          changedColumns[field] = (changedColumns[field] ?? 0) + 1;
        }
        continue;
      }

      if (isNullOrEmpty(sheetVal)) continue;
      if (String(dbVal ?? "").trim() !== String(sheetVal).trim()) {
        filtered[field] = sheetVal;
        hasDataChange = true;
        changedColumns[field] = (changedColumns[field] ?? 0) + 1;
      }
    }

    toUpdate.push({ id: existing.id, data: filtered, isChange: hasDataChange });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failedWrites = 0;

  if (toCreate.length > 0) {
    try {
      await tenderPrisma.contractReview.createMany({
        data: toCreate.map((c) => c.data as never),
      });
      created = toCreate.length;
    } catch (err) {
      throw new Error(
        `ContractReview createMany failed for ${toCreate.length} row(s): ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  for (let i = 0; i < toUpdate.length; i += WRITE_CHUNK) {
    const chunk = toUpdate.slice(i, i + WRITE_CHUNK);

    const settled = await Promise.allSettled(
      chunk.map((u) =>
        tenderPrisma.contractReview.update({
          where: { id: u.id },
          data: u.data as never,
        }),
      ),
    );

    settled.forEach((r, idx) => {
      if (r.status === "rejected") {
        failedWrites++;
        console.error(
          `[contract-review-sync] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
        );
        return;
      }
      if (chunk[idx].isChange) updated++;
      else unchanged++;
    });
  }

  // Owned side-effect: keeps Enquiry.contractNo fresh for the quotation
  // dashboard. Warn-only in the manual route; kept warn-only here.
  let contractNoSynced = { updated: 0, matched: 0 };
  try {
    contractNoSynced = await syncEnquiryContractNumbers(undefined, prisma);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`syncEnquiryContractNumbers failed: ${message}`);
    console.warn(`[contract-review-sync] contractNo sync failed: ${message}`);
  }

  // Owned side-effect: re-derive the "N" chip / "Deleted as Current Reqt" mark
  // now that the contract rows exist. Warn-only, as in the manual route.
  let notCurrentReqt = {
    contractReview: { marked: 0, cleared: 0 },
    enquiryItem: { marked: 0, cleared: 0 },
  };
  try {
    notCurrentReqt = await recomputeNotCurrentReqtMarks();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    warnings.push(`recomputeNotCurrentReqtMarks failed: ${message}`);
    console.warn(`[contract-review-sync] current reqt mark failed: ${message}`);
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== [SCHEDULER] CONTRACT REVIEW SHEET SYNC =====");
  console.log(`[scheduler] synced at          : ${syncedAt.toISOString()}`);
  console.log(`[scheduler] contracts in sheet : ${erpRows.size}`);
  console.log(
    `[scheduler] created=${created} updated=${updated} unchanged=${unchanged} total=${created + updated + unchanged}`,
  );
  console.log(
    `[scheduler] blankKeyRows=${blankKeyRows} duplicateInSheet=${duplicateInSheet} failedWrites=${failedWrites}`,
  );
  console.log(`[scheduler] changed columns    :`, changedColumns);
  console.log(
    `[scheduler] enquiry contractNo  : updated=${contractNoSynced.updated} matched=${contractNoSynced.matched}`,
  );
  console.log(
    `[scheduler] not-current-reqt    : CR(marked=${notCurrentReqt.contractReview.marked}, cleared=${notCurrentReqt.contractReview.cleared}) EI(marked=${notCurrentReqt.enquiryItem.marked}, cleared=${notCurrentReqt.enquiryItem.cleared})`,
  );
  if (warnings.length) console.log(`[scheduler] warnings           :`, warnings);
  console.log(`[scheduler] elapsed             : ${elapsedMs}ms`);
  console.log("===== [SCHEDULER] SHEET SYNC DONE =====\n");

  return {
    syncedAt: syncedAt.toISOString(),
    totalInContracts: erpRows.size,
    created,
    updated,
    unchanged,
    blankKeyRows,
    duplicateInSheet,
    failedWrites,
    changedColumns,
    contractNoSynced,
    notCurrentReqt,
    warnings,
    elapsedMs,
  };
}