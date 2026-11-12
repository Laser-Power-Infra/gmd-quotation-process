import "server-only";

import { stockPrisma } from "@gmd/db-stock";
import { parseQty } from "@gmd/purchase/in-transit";
import { prisma } from "@/lib/prisma";
import { parseGmdDate } from "@/lib/gmd_lib/dateParse";
import { parseReportDate } from "@/lib/inspectionReport";
import { MAX_BOM_DEPTH, unitCost, type CostBook, type UnitCost } from "@/lib/lineCost";
import { latestByContractItem, quoteKey } from "@/lib/quotedCost";

export type LineCostInput = { code: string; date: Date | null; contractNo: string | null };
/** `unitCost` / `basis` from lib/lineCost.ts; `quotedUnitCost` = the Quotation app's cost for the contract line. */
export type LineCost = UnitCost & { quotedUnitCost: number | null };

/** The `costLines` input for one SupplyHistoryItem row. */
export const supplyCostInput = (r: { erpItemCode: string | null; date: string | null; erpContractNo: string | null }): LineCostInput => ({
  code: (r.erpItemCode ?? "").trim(),
  date: parseGmdDate(r.date),
  contractNo: r.erpContractNo?.trim() || null,
});

const up = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Unit cost and quoted unit cost of each sold line, in input order. Purchase rates come from
 * GRN (PUR_VALUE ÷ QTYRECD), falling back to the received PURCHASE ORD AND GRN lines for codes
 * with no GRN; BOMs from the open BomItem lines (qty = erpQty ?? quantity); quotes from
 * lib/quotedCost.ts. A handful of queries per call, no cache. A failed load is logged and leaves
 * every line's cost missing (never 0), so the Sales Register and Supply History stay up.
 */
export async function costLines(inputs: LineCostInput[]): Promise<LineCost[]> {
  try {
    return await loadCostLines(inputs);
  } catch (err) {
    console.error("[lineCost] cost load failed, every line shows cost missing", err);
    return inputs.map(() => ({ unitCost: null, basis: null, quotedUnitCost: null }));
  }
}

async function loadCostLines(inputs: LineCostInput[]): Promise<LineCost[]> {
  const book: CostBook = { receipts: new Map(), boms: new Map() };

  // Open BOM lines, level by level as deep as unitCost expands, collecting every part code on the way.
  let level = [...new Set(inputs.map((i) => up(i.code)).filter(Boolean))];
  const codes = new Set(level);
  for (let depth = 0; depth < MAX_BOM_DEPTH && level.length > 0; depth++) {
    const boms = await prisma.bom.findMany({
      where: { fullItem: { itemCode: { in: level, mode: "insensitive" } } },
      select: {
        bomId: true,
        fullItem: { select: { itemCode: true } },
        components: {
          select: {
            noUse: true,
            erpQty: true,
            quantity: true,
            rawMaterial: { select: { erpItemCode: true } },
            fullItem: { select: { itemCode: true } },
          },
        },
      },
    });
    const next: string[] = [];
    for (const b of boms) {
      for (const c of b.components) {
        // Unlinked rows (freed slots) and lines BOM MAST ERP closed are not part of the BOM.
        if ((!c.rawMaterial && !c.fullItem) || up(c.noUse) === "NO USE") continue;
        // A linked part with no code stays in: it finds no rate, so the BOM cost is missing (R7).
        const part = up(c.rawMaterial?.erpItemCode || c.fullItem?.itemCode);
        push(book.boms, up(b.fullItem.itemCode), { bomId: b.bomId, code: part, qty: c.erpQty !== null ? Number(c.erpQty) : c.quantity });
        if (part && !codes.has(part)) {
          codes.add(part);
          next.push(part);
        }
      }
    }
    level = next;
  }

  const addReceipt = (code: string | null, day: string | null, qty: number | null, value: number | null) => {
    const at = parseReportDate(day ?? "");
    // No day, qty or value: the receipt says nothing about the rate.
    if (at === null || qty === null || value === null || qty <= 0 || value <= 0) return;
    push(book.receipts, up(code), { at, qty, value });
  };

  const all = [...codes];
  const [grn, quotes] = await Promise.all([
    stockPrisma.grnLine.findMany({
      where: { itemCode: { in: all, mode: "insensitive" } },
      select: { itemCode: true, vrDate: true, qtyRecd: true, purValue: true },
    }),
    latestByContractItem(inputs.filter((i) => i.contractNo).map((i) => i.code)),
  ]);
  for (const g of grn) addReceipt(g.itemCode, g.vrDate, g.qtyRecd, g.purValue);

  const noGrn = all.filter((c) => !book.receipts.has(c));
  if (noGrn.length > 0) {
    const poLines = await stockPrisma.purchaseOrderLine.findMany({
      where: { itemCode: { in: noGrn, mode: "insensitive" } },
      select: { itemCode: true, grnDate: true, poDate: true, qtyExecuted: true, rate: true },
    });
    for (const p of poLines) {
      const qty = parseQty(p.qtyExecuted);
      const rate = parseQty(p.rate);
      addReceipt(p.itemCode, p.grnDate || p.poDate, qty, qty !== null && rate !== null ? qty * rate : null);
    }
  }

  return inputs.map((i) => {
    // Receipt days are UTC midnights (parseReportDate), so key the invoice on its calendar day too.
    const at = i.date ? Date.UTC(i.date.getFullYear(), i.date.getMonth(), i.date.getDate()) : null;
    const quoted = Number(i.contractNo ? quotes.get(quoteKey(i.contractNo, i.code))?.cost : null);
    return { ...unitCost(i.code, at, book), quotedUnitCost: quoted > 0 ? quoted : null };
  });
}
