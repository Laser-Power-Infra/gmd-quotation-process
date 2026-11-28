/**
 * Service / Work Orders: which item codes are services, no DB.
 *
 *   ITEM MASTER ERP (gid 253020709, GMD EXECUTION TRACKING workbook) -> `ServiceItem`
 *   (quotation DB), written by the service-orders job.
 *
 * The page (`@gmd/service-orders`) joins these codes in SQL with the stock DB's
 * `PurchaseOrderLine` and `GrnLine`, which the purchase-orders job mirrors.
 */

import { cell, requireColumns } from "./gmd_lib/bomMastErp";

export const ITEM_MASTER_GID = 253020709;

type Tab = { tabTitle?: string; headers: string[]; rows: string[][] };

/** ITEM MASTER ERP rows whose LEVEL_1_NAME is SERVICES or ITEM_NATURE is SR. */
export function serviceItemsFrom(tab: Tab): { itemCode: string; itemName: string | null }[] {
  const [codeIdx, nameIdx, levelIdx, natureIdx] = requireColumns(
    tab.headers,
    ["ITEM_CODE", "ITEM_NAME", "LEVEL_1_NAME", "ITEM_NATURE"],
    tab.tabTitle ?? "ITEM MASTER ERP",
  );
  const out = new Map<string, string | null>();
  for (const row of tab.rows) {
    const code = cell(row, codeIdx).toUpperCase();
    if (!code || code === "ITEM_CODE" || out.has(code)) continue;
    if (cell(row, levelIdx).toUpperCase() === "SERVICES" || cell(row, natureIdx).toUpperCase() === "SR") {
      out.set(code, cell(row, nameIdx) || null);
    }
  }
  return [...out].map(([itemCode, itemName]) => ({ itemCode, itemName }));
}
