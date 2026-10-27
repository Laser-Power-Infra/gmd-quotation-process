/**
 * One-off backfill — SALE BILL `ACC_YEAR` -> a blank `SupplyHistoryItem.financialYear`.
 *
 * The hourly execution-tracking job only reads the fiscal year it is told to run,
 * and a row whose `financialYear` is blank is outside that scope filter — so the
 * engine can never match it, which also means it can never be repaired by a
 * normal sync (and `erp-contract-no` skips it for the same reason). This reads the
 * whole tab once and fills every blank FY in the table, regardless of year.
 *
 * Gap-fill only, by construction: the query loads rows whose FY is blank, and an
 * existing value is never overwritten — so a row stored as `26-27` is left alone
 * rather than churned to the canonical `2026-27`.
 *
 * Keyed on `(VRNO, ITEM_CODE)` — the pair the execution-tracking engine uses —
 * normalised on both sides. A SALE BILL line with no item code cannot be
 * attributed to one row when its invoice owns several, so it is skipped and
 * counted rather than guessed.
 */

import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { cell, findColumn, readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import {
  SALE_BILL_KEY_HEADERS,
  executionTrackingSpreadsheetId,
  isBlankSheetValue,
  normalizeFiscalYear,
  normalizeKey,
  saleBillGid,
} from "@/lib/gmd_lib/execution-tracking-columns";

/** Invoice number — half 1 of the match key, as in the engine. */
const INVOICE_HEADER = "VRNO";
/** Item code — half 2 of the match key. */
const ITEM_CODE_HEADER = "ITEM_CODE";

const WRITE_CHUNK = 200;
const WRITE_CONCURRENCY = 10;

/** `(VRNO, ITEM_CODE)` -> the map key, normalised on both halves. */
export function yearKey(invoiceNo: unknown, itemCode: unknown): string {
  return `${normalizeKey(invoiceNo)}||${normalizeKey(itemCode)}`;
}

export type SaleBillYearMap = {
  years: Map<string, string>;
  sheetRows: number;
  skippedNoCode: number;
  skippedBlankYear: number;
  skippedUnparseableYear: number;
};

/**
 * Reduces the tab to `(invoice, item code) -> fiscal year`, first non-blank value
 * winning, normalised to the four-digit `2026-27` form the engine writes.
 *
 * Throws when a key column or the FY column is gone: silently skipping a mapping
 * is how a backfill reports success while writing nothing.
 */
export function buildYearMap(
  headers: string[],
  rows: string[][],
): SaleBillYearMap {
  const required = [INVOICE_HEADER, ITEM_CODE_HEADER];
  const indexes = required.map((h) => findColumn(headers, h));
  const missing = required.filter((_, i) => indexes[i] === -1);
  if (missing.length > 0) {
    throw new Error(`SALE BILL tab is missing required column(s): ${missing.join(", ")}`);
  }

  const yearIdx = SALE_BILL_KEY_HEADERS.financialYearAliases
    .map((alias) => findColumn(headers, alias))
    .find((idx) => idx >= 0);
  if (yearIdx === undefined) {
    throw new Error(
      `SALE BILL tab has no fiscal-year column (looked for: ${SALE_BILL_KEY_HEADERS.financialYearAliases.join(", ")}).`,
    );
  }
  const [invoiceIdx, itemCodeIdx] = indexes;

  const years = new Map<string, string>();
  let skippedNoCode = 0;
  let skippedBlankYear = 0;
  let skippedUnparseableYear = 0;

  for (const row of rows) {
    const invoiceNo = cell(row, invoiceIdx);
    const itemCode = cell(row, itemCodeIdx);
    if (!invoiceNo || !itemCode) {
      skippedNoCode++;
      continue;
    }
    const raw = cell(row, yearIdx);
    if (isBlankSheetValue(raw)) {
      skippedBlankYear++;
      continue;
    }
    const year = normalizeFiscalYear(raw);
    if (!year) {
      skippedUnparseableYear++;
      continue;
    }
    const key = yearKey(invoiceNo, itemCode);
    if (!years.has(key)) years.set(key, year);
  }

  return { years, sheetRows: rows.length, skippedNoCode, skippedBlankYear, skippedUnparseableYear };
}

/** The `SupplyHistoryItem` slice this backfill reads. */
export type YearRow = {
  id: string;
  invoiceNo: string | null;
  erpItemCode: string | null;
  financialYear: string | null;
};

export type YearPlan = {
  updates: { id: string; financialYear: string }[];
  rowsScanned: number;
  /** Rows with no invoice/item code, so they can never match. */
  skippedNoCode: number;
  /** Rows whose key is not on the sheet, so nothing could be filled. */
  unmatched: number;
  filled: number;
};

/** Decides, per blank row, whether the sheet supplies a fiscal year. Pure. */
export function planYearBackfill(
  rows: readonly YearRow[],
  years: ReadonlyMap<string, string>,
): YearPlan {
  const updates: YearPlan["updates"] = [];
  let skippedNoCode = 0;
  let unmatched = 0;

  for (const row of rows) {
    if (String(row.financialYear ?? "").trim()) continue; // never overwrite

    const invoiceNo = String(row.invoiceNo ?? "").trim();
    const itemCode = String(row.erpItemCode ?? "").trim();
    if (!invoiceNo || !itemCode) {
      skippedNoCode++;
      continue;
    }

    const year = years.get(yearKey(invoiceNo, itemCode));
    if (!year) {
      unmatched++;
      continue;
    }
    updates.push({ id: row.id, financialYear: year });
  }

  return { updates, rowsScanned: rows.length, skippedNoCode, unmatched, filled: updates.length };
}

export type SupplyYearBackfillResult = {
  tabTitle: string;
  sheetRows: number;
  sheetYears: number;
  sheetSkippedNoCode: number;
  sheetSkippedBlankYear: number;
  sheetSkippedUnparseableYear: number;
  rowsScanned: number;
  filled: number;
  skippedNoCode: number;
  unmatched: number;
  failedWrites: number;
  elapsedMs: number;
};

/**
 * Reads the sale-bill tab and fills every blank `financialYear` it can.
 * `apply: false` stops before the writes and reports what it would do.
 *
 * Throws on a fatal error (sheet unreachable, required column gone, OAuth
 * failure); individual write failures are counted instead of aborting the run.
 */
export async function runSupplyYearBackfill(options: {
  apply: boolean;
  limit?: number;
}): Promise<SupplyYearBackfillResult> {
  const startedAt = Date.now();

  const { tabTitle, headers, rows } = await readSheetTabByGid(
    executionTrackingSpreadsheetId(),
    saleBillGid(),
  );
  const map = buildYearMap(headers, rows);

  const dbRows = (await prisma.supplyHistoryItem.findMany({
    where: { OR: [{ financialYear: null }, { financialYear: "" }] },
    select: { id: true, invoiceNo: true, erpItemCode: true, financialYear: true },
  })) as YearRow[];

  const limited =
    typeof options.limit === "number" && options.limit >= 0
      ? dbRows.slice(0, options.limit)
      : dbRows;

  const plan = planYearBackfill(limited, map.years);

  let failedWrites = 0;
  if (options.apply) {
    const throttle = pLimit(WRITE_CONCURRENCY);

    for (let i = 0; i < plan.updates.length; i += WRITE_CHUNK) {
      const chunk = plan.updates.slice(i, i + WRITE_CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((u) =>
          throttle(() =>
            prisma.supplyHistoryItem.update({
              where: { id: u.id },
              data: { financialYear: u.financialYear },
            }),
          ),
        ),
      );
      settled.forEach((r, idx) => {
        if (r.status === "rejected") {
          failedWrites++;
          console.error(
            `[supply-year-backfill] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
          );
        }
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;

  console.log("\n===== SUPPLY FINANCIAL YEAR BACKFILL =====");
  console.log(`[backfill] mode             : ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[backfill] tab              : ${tabTitle} (gid ${saleBillGid()})`);
  console.log(
    `[backfill] sheet rows       : ${map.sheetRows} (no code/invoice: ${map.skippedNoCode}, blank year: ${map.skippedBlankYear}, unparseable: ${map.skippedUnparseableYear})`,
  );
  console.log(`[backfill] sheet years      : ${map.years.size}`);
  console.log(`[backfill] blank db rows    : ${plan.rowsScanned}`);
  console.log(`[backfill] ${options.apply ? "filled" : "would fill"} : ${plan.filled}`);
  console.log(`[backfill] no code on row   : ${plan.skippedNoCode}`);
  console.log(`[backfill] unmatched        : ${plan.unmatched}`);
  if (options.apply) console.log(`[backfill] failed writes    : ${failedWrites}`);
  console.log(`[backfill] elapsed          : ${elapsedMs}ms`);
  console.log("==========================================\n");

  for (const update of plan.updates.slice(0, 20)) {
    const row = limited.find((r) => r.id === update.id);
    console.log(`  ${row?.invoiceNo ?? "?"} / ${row?.erpItemCode ?? "?"} -> ${update.financialYear}`);
  }
  if (plan.updates.length > 20) {
    console.log(`  ... ${plan.updates.length - 20} more`);
  }

  return {
    tabTitle,
    sheetRows: map.sheetRows,
    sheetYears: map.years.size,
    sheetSkippedNoCode: map.skippedNoCode,
    sheetSkippedBlankYear: map.skippedBlankYear,
    sheetSkippedUnparseableYear: map.skippedUnparseableYear,
    rowsScanned: plan.rowsScanned,
    filled: plan.filled,
    skippedNoCode: plan.skippedNoCode,
    unmatched: plan.unmatched,
    failedWrites,
    elapsedMs,
  };
}
