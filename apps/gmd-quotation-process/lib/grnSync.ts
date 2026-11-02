/**
 * `GRN` -> `GrnLine` (stock DB).
 *
 * Source: the `GRN_GID` tab of `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` — one
 * row per receipt line. The Purchase dashboard joins it to `PurchaseOrderLine`
 * on (ORDER_VRNO, ORDER_SLNO) = (VRNO, SLNO) to show what arrived against a PO.
 *
 * The tab has no unique key (one GRN repeats per item), so this is a snapshot
 * copy like the ledger sync: the table is replaced in one transaction. A missing
 * key column throws before anything is deleted.
 */

import { stockPrisma } from "@gmd/db-stock";
import { cell, findColumn, readSheetTabByGid, requireColumns } from "@/lib/gmd_lib/bomMastErp";
import { executionTrackingSpreadsheetId } from "@/lib/gmd_lib/execution-tracking-columns";
import { isBlankSheetValue, isRepeatedHeaderRow } from "@gmd/purchase/columns";
import { parseQty } from "@gmd/purchase/in-transit";

const CHUNK = 500;

/** `GRN_GID`, with the live gid as the fallback (confirmed 2026-10-31). */
export function grnGid(): number {
  const gid = Number(process.env.GRN_GID);
  return process.env.GRN_GID && Number.isInteger(gid) ? gid : 372231442;
}

const TEXT_COLUMNS = [
  ["MAIN_POST_NAME", "mainPostName"],
  ["ACC_CODE", "accCode"],
  ["VRDATE", "vrDate"],
  ["ITEM_CODE", "itemCode"],
  ["PARTYBILLNO", "partyBillNo"],
  ["PARTYBILLDATE", "partyBillDate"],
  ["ORDER_VRNO", "orderVrNo"],
  ["ORDER_SLNO", "orderSlNo"],
] as const;

export type GrnRecord = {
  vrNo: string;
  qtyRecd: number | null;
  purValue: number | null;
} & Partial<Record<(typeof TEXT_COLUMNS)[number][1], string>>;

/** Sheet rows -> records. Pure, so it is tested without the sheet. */
export function mapGrnRows(headers: string[], rows: string[][], tabTitle = "GRN"): { records: GrnRecord[]; skipped: number } {
  const [vrNoIdx] = requireColumns(headers, ["VRNO", "ORDER_VRNO", "ORDER_SLNO"], tabTitle);
  const qtyIdx = findColumn(headers, "QTYRECD");
  const valueIdx = findColumn(headers, "PUR_VALUE");
  const textIdx = TEXT_COLUMNS.map(([sheet, db]) => [findColumn(headers, sheet), db] as const);

  const records: GrnRecord[] = [];
  let skipped = 0;
  for (const row of rows) {
    const vrNo = cell(row, vrNoIdx);
    if (!vrNo || isRepeatedHeaderRow(vrNo)) {
      skipped += 1;
      continue;
    }
    const rec: GrnRecord = { vrNo, qtyRecd: parseQty(cell(row, qtyIdx)), purValue: parseQty(cell(row, valueIdx)) };
    for (const [idx, db] of textIdx) {
      const v = cell(row, idx);
      if (!isBlankSheetValue(v)) rec[db] = v;
    }
    records.push(rec);
  }
  return { records, skipped };
}

export interface GrnSyncResult {
  tabTitle: string;
  sheetRows: number;
  skippedRows: number;
  written: number;
  /** Rows carrying an ORDER_VRNO, i.e. joinable to a PO line. */
  linkedToPo: number;
}

export async function syncGrnLines(options: { dryRun?: boolean } = {}): Promise<GrnSyncResult> {
  const { tabTitle, headers, rows } = await readSheetTabByGid(executionTrackingSpreadsheetId(), grnGid());
  const { records, skipped } = mapGrnRows(headers, rows, tabTitle);

  if (!options.dryRun) {
    await stockPrisma.$transaction(
      async (tx) => {
        await tx.grnLine.deleteMany();
        for (let i = 0; i < records.length; i += CHUNK) {
          await tx.grnLine.createMany({ data: records.slice(i, i + CHUNK) });
        }
      },
      { timeout: 120_000 },
    );
  }

  return {
    tabTitle,
    sheetRows: rows.length,
    skippedRows: skipped,
    written: options.dryRun ? 0 : records.length,
    linkedToPo: records.filter((r) => r.orderVrNo).length,
  };
}
