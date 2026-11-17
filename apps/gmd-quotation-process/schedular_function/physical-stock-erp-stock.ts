/**
 * ITEM MASTER ERP `STOCK` -> stock DB `PhysicalStock.stock_as_per_erp`, matched on
 * ITEM_CODE = erp_code. Runs as a step of the hourly physical-stock-cost-bom job.
 *
 * Only `stock_as_per_erp` is written. A code missing from the sheet, or with a blank
 * STOCK cell, keeps the value it has.
 */

import {
  BOM_MAST_ERP_SPREADSHEET_ID,
  ITEM_MASTER_ERP_GID,
  cell,
  readSheetTabByGid,
  requireColumns,
} from "@/lib/gmd_lib/bomMastErp";

export type ErpStockSyncResult = {
  /** Item codes with a STOCK value in the sheet. */
  sheetCodes: number;
  scanned: number;
  updated: number;
  /** PhysicalStock rows whose erp_code is not in the sheet (left untouched). */
  unmatched: number;
};

type Tab = { tabTitle?: string; headers: string[]; rows: string[][] };

/** Upper-cased ITEM_CODE -> STOCK as shown in the sheet. First row wins on a duplicate code. */
export function erpStockByCode(tab: Tab): Map<string, string> {
  const [codeIdx, stockIdx] = requireColumns(tab.headers, ["ITEM_CODE", "STOCK"], tab.tabTitle ?? "ITEM MASTER ERP");
  const out = new Map<string, string>();
  for (const row of tab.rows) {
    const code = cell(row, codeIdx).toUpperCase();
    const stock = cell(row, stockIdx);
    // The tab repeats its header as the first data row.
    if (!code || code === "ITEM_CODE" || !stock || out.has(code)) continue;
    out.set(code, stock);
  }
  return out;
}

export async function syncPhysicalStockErpStock(opts: { dryRun?: boolean } = {}): Promise<ErpStockSyncResult> {
  const { stockPrisma } = await import("@/lib/stockPrisma");
  const stockByCode = erpStockByCode(await readSheetTabByGid(BOM_MAST_ERP_SPREADSHEET_ID, ITEM_MASTER_ERP_GID));
  const rows = await stockPrisma.physicalStock.findMany({ select: { id: true, erp_code: true, stock_as_per_erp: true } });

  // Group ids by new value: one UPDATE per distinct stock figure instead of one per row.
  const idsByStock = new Map<string, string[]>();
  let unmatched = 0;
  let updated = 0;
  for (const row of rows) {
    const next = stockByCode.get((row.erp_code ?? "").trim().toUpperCase());
    if (next === undefined) unmatched++;
    else if (next !== row.stock_as_per_erp) {
      idsByStock.set(next, [...(idsByStock.get(next) ?? []), row.id]);
      updated++;
    }
  }
  for (const [stock, ids] of opts.dryRun ? [] : idsByStock) {
    await stockPrisma.physicalStock.updateMany({ where: { id: { in: ids } }, data: { stock_as_per_erp: stock } });
  }
  return { sheetCodes: stockByCode.size, scanned: rows.length, updated, unmatched };
}
