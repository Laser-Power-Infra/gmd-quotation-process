/** CHINA LOT ALLOCATION tab (GMD CLIENTS WISE): parse rows and match each lot to a purchase line. Pure, no I/O. */

export interface SheetRow {
  contractNo: string; itemCode: string; size: string; qty: number; qtyRaw: string; // qty is NaN when the cell is not a plain number
  lot: string; tinaInvoiceNo: string; blStatus: string; needsConfirmation: boolean;
}
export interface PoLine { poNo: string; poLineNo: string; itemCode: string | null; salesContract: string | null; partyRefNo: string | null }
export type UnmatchedReason = "no purchase line" | "ambiguous" | "quantity not a plain number";

// Puja's rule: these two stay "needs confirmation" until she signs off.
const NEEDS_CONFIRMATION = new Set(["SD26Y-00058|FSD040002", "SD26Y-00058|FSD040044"]);
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** "WS26-340C (51th)" -> "WS26-340C" */
const invoiceToken = (s: string) => up(s).split(/\s+/)[0];

/**
 * Cells A..M of the tab. Continuation rows (blank SEQ) inherit contract/item from the row above; rows whose source is not a
 * lot (physical stock) or whose QTY ALLOCATED is blank are skipped. A non-blank cell that is not a plain number gets qty NaN
 * (matchLots reports it).
 */
export function parseLotRows(cells: string[][]): SheetRow[] {
  const out: SheetRow[] = [];
  let ctx = { contractNo: "", itemCode: "", size: "" };
  for (const c of cells) {
    const [seq = "", contract = "", , , , item = "", size = "", , , source = "", invoice = "", bl = "", alloc = ""] = c.map((x) => (x ?? "").trim());
    if (up(c[0]).startsWith("BALANCE LEFT")) break;
    if (/^\d+[A-Z]?$/.test(seq)) ctx = { contractNo: contract, itemCode: item, size };
    else if (seq) continue; // header / notes
    if (!/\bLOT$/i.test(source)) continue;
    if (!ctx.contractNo || !ctx.itemCode || !alloc) continue;
    // whole cell must be a plain positive number; "1,200", "10 (of 20)", "40 + 20" are never guessed
    const qty = /^\d+(\.\d+)?$/.test(alloc) && Number(alloc) > 0 ? Number(alloc) : NaN;
    out.push({ ...ctx, qty, qtyRaw: alloc, lot: source, tinaInvoiceNo: invoice, blStatus: bl, needsConfirmation: NEEDS_CONFIRMATION.has(`${ctx.contractNo}|${ctx.itemCode}`) });
  }
  return out;
}

/** Join: Tina invoice token = partyRefNo AND item code; else sales contract (contains) AND item code. One candidate = match. */
export function matchLots(rows: SheetRow[], purchaseLines: PoLine[]) {
  const matched: { row: SheetRow; poNo: string; poLineNo: string }[] = [];
  const unmatched: { row: SheetRow; reason: UnmatchedReason }[] = [];
  for (const row of rows) {
    if (!(row.qty > 0)) { unmatched.push({ row, reason: "quantity not a plain number" }); continue; }
    const sameItem = purchaseLines.filter((l) => up(l.itemCode) === up(row.itemCode));
    const tok = invoiceToken(row.tinaInvoiceNo);
    let cands = tok ? sameItem.filter((l) => up(l.partyRefNo) === tok) : [];
    if (!cands.length && row.contractNo) cands = sameItem.filter((l) => up(l.salesContract).includes(up(row.contractNo)));
    if (cands.length === 1) matched.push({ row, poNo: cands[0].poNo, poLineNo: cands[0].poLineNo });
    else unmatched.push({ row, reason: cands.length ? "ambiguous" : "no purchase line" });
  }
  return { matched, unmatched };
}
