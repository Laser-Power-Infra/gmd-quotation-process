/**
 * Unit cost of a sold item, for the Sales Register gross profit and the Supply History
 * BOM COST / RAWMATERIAL COST cells (GMD EXECUTION TRACKING, Puja Agarwal, 10 Nov 2026).
 *
 *   - Trading item: its own purchase rate, GRN value ÷ qty received.
 *   - Manufactured item: Σ BOM qty × each part's unit cost, from the highest-numbered
 *     open BOM.
 *
 * Missing cost is never zero: a part with no rate, or a line with no qty, makes the whole
 * cost null. Pure; `lib/lineCost-server.ts` loads the book.
 */
import { compareBomIdsDescending } from "./bomOrder";

/** One receipt: `at` = the receipt day (epoch ms, UTC midnight), `value` in ₹ for `qty` units. */
export type Receipt = { at: number; qty: number; value: number };

/** One open BOM line of an item: the part's code and its qty per unit (null when unknown). */
export type BomLine = { bomId: string; code: string; qty: number | null };

/** Receipts by part code and open BOM lines by item code, both keyed on the upper-cased code. */
export type CostBook = { receipts: Map<string, Receipt[]>; boms: Map<string, BomLine[]> };

export type UnitCost = { unitCost: number | null; basis: "Purchase" | "BOM" | null };

const MISSING: UnitCost = { unitCost: null, basis: null };
/** BOM levels expanded below the sold item; also what stops a BOM that lists itself. */
export const MAX_BOM_DEPTH = 3;

/**
 * Rate on the latest receipt day on or before `at`, qty-weighted within that day; with no
 * receipt by then, the first receipt day after. An undated sale (`at` null) takes the latest day.
 */
export function receiptRate(list: Receipt[], at: number | null): number | null {
  const days = [...new Set(list.map((r) => r.at))].sort((a, b) => a - b);
  if (days.length === 0) return null;
  const day = at === null ? days[days.length - 1] : (days.filter((d) => d <= at).pop() ?? days[0]);
  let qty = 0;
  let value = 0;
  for (const r of list) {
    if (r.at !== day) continue;
    qty += r.qty;
    value += r.value;
  }
  return qty > 0 ? value / qty : null;
}

/** Own receipts first ("Purchase"), else the highest-numbered open BOM ("BOM"). */
export function unitCost(code: string, at: number | null, book: CostBook, depth = 0): UnitCost {
  const key = code.trim().toUpperCase();
  const rate = receiptRate(book.receipts.get(key) ?? [], at);
  if (rate !== null) return { unitCost: rate, basis: "Purchase" };

  const lines = book.boms.get(key) ?? [];
  if (lines.length === 0 || depth >= MAX_BOM_DEPTH) return MISSING;
  const bomId = lines.map((l) => l.bomId).sort(compareBomIdsDescending)[0];
  let sum = 0;
  for (const line of lines) {
    if (line.bomId !== bomId) continue;
    const part = unitCost(line.code, at, book, depth + 1).unitCost;
    // 0 counts as missing too: VERIFY BOM's parseInt turns a 0.5 into 0.
    if (part === null || line.qty === null || !(line.qty > 0)) return MISSING;
    sum += line.qty * part;
  }
  return { unitCost: sum, basis: "BOM" };
}
