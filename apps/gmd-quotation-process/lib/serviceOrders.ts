/**
 * Service / Work Orders: pure mapping and joins, no DB.
 *
 * Sources (all in the GMD EXECUTION TRACKING workbook):
 *   ITEM MASTER ERP (gid 253020709)  -> which item codes are services (`ServiceItem`,
 *                                       quotation DB, written by the service-orders job)
 *   PURCHASE ORD AND GRN             -> order lines, mirrored into the stock DB's
 *                                       `PurchaseOrderLine` by the purchase-orders
 *                                       job; BALANCE = still pending
 *   GRN (gid 372231442)              -> receipts, mirrored into the stock DB's
 *                                       `GrnLine` by the same job; joined on
 *                                       ORDER_VRNO + ORDER_SLNO = VRNO + SLNO
 */

import { cell, requireColumns } from "./gmd_lib/bomMastErp";
import { parseSheetDate } from "./debtorsSync";
import { inTransitQty, parseQty } from "@gmd/purchase/in-transit";

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

/** VRDATE is DD-MM-YYYY, DELIVERY_SCH is YYYY-MM-DD; anything else is no date. */
export function sheetDay(raw: string | null): Date | null {
  const s = (raw ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  try {
    const d = parseSheetDate(s);
    // parseSheetDate guards the day only; 08-14-2116 (a mangled BASIC_AMT-style cell) would roll over.
    return d && d.getUTCMonth() + 1 === Number(s.split("-")[1]) ? d : null;
  } catch {
    return null;
  }
}

const key = (vrno: string | null, slno: string | null) =>
  `${(vrno ?? "").trim().toUpperCase()}|${(slno ?? "").trim()}`;
const DAY = 86_400_000;

/** The stock-DB `PurchaseOrderLine` columns this page reads. */
export type PoLine = {
  id: string;
  poNo: string;
  poLineNo: string;
  poDate: string | null;
  itemCode: string | null;
  itemName: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  uom: string | null;
  netQtyOrder: string | null;
  qtyExecuted: string | null;
  balanceQty: string | null;
  rate: string | null;
  exchangeRate: string | null;
  deliverySched: string | null;
};

/** The stock-DB `GrnLine` columns this page reads. */
export type GrnReceipt = {
  vrNo: string;
  vrDate: string | null;
  partyBillNo: string | null;
  orderVrNo: string | null;
  orderSlNo: string | null;
};

export type ServiceOrderRow = {
  id: string;
  orderNo: string;
  lineNo: string;
  orderDate: string | null; // ISO
  supplier: string | null;
  supplierCode: string | null;
  serviceCode: string;
  serviceName: string | null;
  um: string | null;
  ordered: number | null;
  received: number | null;
  pending: number;
  rate: number | null;
  /** pending x rate x exchange rate (1 when blank). */
  pendingValue: number | null;
  dueDate: string | null; // ISO
  /** Days since the order date, while anything is pending. */
  daysPending: number | null;
  overdue: boolean;
  open: boolean;
  grnCount: number;
  lastGrnNo: string | null;
  lastGrnDate: string | null; // ISO
  lastBillNo: string | null;
};

/** Service PO lines with their GRN receipts, open lines first, oldest first. */
export function buildServiceOrders(
  po: PoLine[],
  grn: GrnReceipt[],
  serviceCodes: Set<string>,
  today: Date,
): ServiceOrderRow[] {
  const receipts = new Map<string, GrnReceipt[]>();
  for (const g of grn) {
    if (!g.orderVrNo) continue;
    const k = key(g.orderVrNo, g.orderSlNo);
    receipts.set(k, [...(receipts.get(k) ?? []), g]);
  }
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  const rows = po
    .filter((p) => serviceCodes.has((p.itemCode ?? "").trim().toUpperCase()))
    .map((p): ServiceOrderRow => {
      const pending = inTransitQty(p);
      const rate = parseQty(p.rate);
      const orderDate = sheetDay(p.poDate);
      const due = sheetDay(p.deliverySched);
      const open = pending > 0;
      const got = (receipts.get(key(p.poNo, p.poLineNo)) ?? [])
        .map((g) => ({ g, d: sheetDay(g.vrDate) }))
        .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));
      const last = got[0];
      return {
        id: p.id,
        orderNo: p.poNo,
        lineNo: p.poLineNo,
        orderDate: orderDate?.toISOString() ?? null,
        supplier: p.supplierName,
        supplierCode: p.supplierCode,
        serviceCode: (p.itemCode ?? "").trim(),
        serviceName: p.itemName,
        um: p.uom,
        ordered: parseQty(p.netQtyOrder),
        received: parseQty(p.qtyExecuted),
        pending,
        rate,
        pendingValue: rate === null ? null : pending * rate * (parseQty(p.exchangeRate) || 1),
        dueDate: due?.toISOString() ?? null,
        daysPending: open && orderDate ? Math.floor((todayUtc - orderDate.getTime()) / DAY) : null,
        overdue: open && !!due && due.getTime() < todayUtc,
        open,
        grnCount: got.length,
        lastGrnNo: last?.g.vrNo ?? null,
        lastGrnDate: last?.d?.toISOString() ?? null,
        lastBillNo: last?.g.partyBillNo ?? null,
      };
    });

  return rows.sort((a, b) => Number(b.open) - Number(a.open) || (b.daysPending ?? -1) - (a.daysPending ?? -1));
}
