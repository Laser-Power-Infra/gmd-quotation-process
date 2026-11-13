/**
 * Execution Registers: GMD EXECUTION TRACKING tabs -> `McRegisterLine` / `ProductionRegisterLine`.
 *
 * Pure, so the rules are tested without a sheet or a database;
 * `schedular_function/execution-registers-sync.ts` reads the tabs, adds the names and writes.
 * Both builders throw on a renamed column or a tab with no lines, before anything is written,
 * so a bad read leaves the last good register in place instead of wiping it.
 */
import { parseQty } from "@gmd/purchase/in-transit";
import { cell, requireColumns } from "./gmd_lib/bomMastErp";
import { parseGmdDate } from "./gmd_lib/dateParse";
import { isBlankSheetValue, normalizeKey, normalizeVrDate } from "./gmd_lib/execution-tracking-columns";
import { prodEntryKey } from "./contractReviewLinks";

export type SheetTab = { tabTitle: string; headers: string[]; rows: string[][] };

export type McLine = {
  mcNo: string;
  slNo: string | null;
  contractNo: string | null;
  contractSlNo: string | null;
  itemCode: string | null;
  bomId: string | null;
  partyItemName: string | null;
  accCode: string | null;
  orderedQty: number;
  cancelledQty: number;
  billedQty: number;
  /** ordered − cancelled − billed; below 0 when over-billed. */
  balanceQty: number;
  inspOfferedQty: number | null;
  inspectedQty: number | null;
  rate: number | null;
  status: "Open" | "Closed";
};

export type ProductionLine = {
  prodOrderNo: string;
  /** dd-MMM-yyyy. */
  prodOrderDate: string | null;
  /** The dump's CONTRACT_VRNO, which holds the MC no. */
  mcNo: string | null;
  itemCode: string;
  bomId: string | null;
  orderedQty: number;
  /** Sum of the PROD ENTRY DUMP receipts against this order + item. */
  producedQty: number;
  balanceQty: number;
  entries: number;
  /** Latest entry VRDATE, dd-MMM-yyyy. */
  lastEntryDate: string | null;
  status: "Pending" | "Completed";
};

// Sheet quantities carry decimals: 3.3 − 1.1 − 2.2 must be 0, not 4e-16 (or -0), or a closed line reopens.
const round3 = (n: number) => Math.round(n * 1000) / 1000 || 0;
const text = (row: string[], idx: number) => (isBlankSheetValue(cell(row, idx)) ? null : cell(row, idx));
const qty = (row: string[], idx: number) => parseQty(cell(row, idx));
/** The dumps repeat their header row; its key cell reads like the header itself. */
const isHeader = (value: string, header: string) => normalizeKey(value) === header;

function noLines(tab: SheetTab): never {
  throw new Error(`Sheet "${tab.tabTitle}" has no lines; the register was left as it was.`);
}

const MC_HEADERS = ["VRNO", "SLNO", "CONTRACT_VRNO", "CONTRACT_SLNO", "ITEM_CODE", "BOM_ID", "PARTY_ITEM_NAME", "ACC_CODE", "QTYORDER", "QTYCANCELLED", "BILLED", "INSPO_SO_QTY", "INSPE_SO_QTY", "RATE"];

/** MC tab -> one line per sheet row. A blank quantity counts as 0. */
export function buildMcLines(tab: SheetTab): { lines: McLine[]; skipped: number } {
  const [vrno, slno, contract, contractSl, item, bom, partyItem, acc, ordered, cancelled, billed, inspOffered, inspected, rate] =
    requireColumns(tab.headers, MC_HEADERS, tab.tabTitle);
  const lines: McLine[] = [];
  let skipped = 0;
  for (const row of tab.rows) {
    const mcNo = text(row, vrno);
    if (!mcNo || isHeader(mcNo, "VRNO")) {
      skipped++;
      continue;
    }
    const orderedQty = qty(row, ordered) ?? 0;
    const cancelledQty = qty(row, cancelled) ?? 0;
    const billedQty = qty(row, billed) ?? 0;
    const balanceQty = round3(orderedQty - cancelledQty - billedQty);
    lines.push({
      mcNo,
      slNo: text(row, slno),
      contractNo: text(row, contract),
      contractSlNo: text(row, contractSl),
      itemCode: text(row, item),
      bomId: text(row, bom),
      partyItemName: text(row, partyItem),
      accCode: text(row, acc),
      orderedQty,
      cancelledQty,
      billedQty,
      balanceQty,
      inspOfferedQty: qty(row, inspOffered),
      inspectedQty: qty(row, inspected),
      rate: qty(row, rate),
      status: balanceQty > 0 ? "Open" : "Closed",
    });
  }
  if (lines.length === 0) noLines(tab);
  return { lines, skipped };
}

const ORDER_HEADERS = ["VRNO", "ITEM_CODE", "VRDATE", "CONTRACT_VRNO", "BOM_ID", "NET_QTYORDER"];
const ENTRY_HEADERS = ["ORDER_VRNO", "ITEM_CODE", "VRDATE", "QTYRECD"];
const dayTime = (day: string | null) => parseGmdDate(day)?.getTime() ?? -Infinity;

/**
 * PROD ORDER DUMP -> one line per production order + item, with the PROD ENTRY DUMP receipts of the
 * same order + item summed in (the key Contract Review's prod entry date uses). Completed once the
 * produced quantity reaches the ordered one. Entries whose order is not on the dump are counted only.
 */
export function buildProductionLines(
  orders: SheetTab,
  entries: SheetTab,
): { lines: ProductionLine[]; skipped: number; unmatchedEntries: number } {
  const [entryOrder, entryItem, entryDate, entryQty] = requireColumns(entries.headers, ENTRY_HEADERS, entries.tabTitle);
  const [vrno, item, date, mc, bom, ordered] = requireColumns(orders.headers, ORDER_HEADERS, orders.tabTitle);

  // A repeated order + item adds its quantity instead of claiming the same entries twice.
  const byKey = new Map<string, ProductionLine>();
  let skipped = 0;
  for (const row of orders.rows) {
    const prodOrderNo = text(row, vrno);
    const itemCode = text(row, item);
    if (!prodOrderNo || !itemCode || isHeader(prodOrderNo, "VRNO")) {
      skipped++;
      continue;
    }
    const key = prodEntryKey(prodOrderNo, itemCode);
    const orderedQty = qty(row, ordered) ?? 0;
    const seen = byKey.get(key);
    if (seen) seen.orderedQty += orderedQty;
    else
      byKey.set(key, {
        prodOrderNo,
        prodOrderDate: normalizeVrDate(cell(row, date)),
        mcNo: text(row, mc),
        itemCode,
        bomId: text(row, bom),
        orderedQty,
        producedQty: 0,
        balanceQty: 0,
        entries: 0,
        lastEntryDate: null,
        status: "Pending",
      });
  }
  if (byKey.size === 0) noLines(orders);

  let unmatchedEntries = 0;
  let entryLines = 0;
  for (const row of entries.rows) {
    if (!cell(row, entryOrder) || !cell(row, entryItem) || isHeader(cell(row, entryOrder), "ORDER_VRNO")) continue;
    entryLines++;
    const line = byKey.get(prodEntryKey(cell(row, entryOrder), cell(row, entryItem)));
    if (!line) {
      unmatchedEntries++;
      continue;
    }
    line.producedQty += qty(row, entryQty) ?? 0;
    line.entries++;
    const day = normalizeVrDate(cell(row, entryDate));
    if (day && dayTime(day) > dayTime(line.lastEntryDate)) line.lastEntryDate = day;
  }
  // An empty entry read would set every order back to produced 0.
  if (entryLines === 0) noLines(entries);

  const lines = [...byKey.values()].map((l): ProductionLine => {
    const orderedQty = round3(l.orderedQty);
    const producedQty = round3(l.producedQty);
    return {
      ...l,
      orderedQty,
      producedQty,
      balanceQty: round3(Math.max(0, orderedQty - producedQty)),
      status: producedQty >= orderedQty ? "Completed" : "Pending",
    };
  });
  return { lines, skipped, unmatchedEntries };
}
