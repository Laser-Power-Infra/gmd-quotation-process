/**
 * Pure logic for the Phase 1 execution pages (Order Status, Ready to Bill, Sales Register).
 *
 * Data comes from tables the hourly jobs already fill from the GMD EXECUTION TRACKING / CONTRACTS
 * sheets: `ContractReview` (db-tender; order, MC, prod order, offer, inspection, DI and billed
 * quantities) and `SupplyHistoryItem` (one row per invoice line, from SALE BILL / MASTER).
 */
import { parseGmdDate } from "./gmd_lib/dateParse";
import { matchItemType } from "./itemTypePatterns";

export const STAGES = ["Order", "Production", "Inspection", "Dispatch", "Bill", "Done"] as const;
export type Stage = (typeof STAGES)[number];

/** Who the line is waiting on at each stage. */
export const PENDING_WITH: Record<Stage, string> = {
  Order: "Planning (production order)",
  Production: "Production",
  Inspection: "QA / customer inspector",
  Dispatch: "Dispatch (DI awaited)",
  Bill: "Accounts (billing)",
  Done: "-",
};

/** Hover text for the short forms the sheet uses. */
export const GLOSSARY: Record<string, string> = {
  MC: "Material Clearance: the quantity cleared against the contract for manufacture/dispatch",
  "Prod order": "Production order raised in the ERP",
  Offer: "Inspection offer (inspection call) sent to the customer's inspector",
  Inspection: "Inspection done; the inspector's clearance number",
  DI: "Dispatch Instruction from the customer",
  Bill: "Sale invoice raised",
};

export type ContractLine = {
  contractNo: string;
  party: string;
  itemCode: string;
  itemName: string;
  dateOfContract: string | null;
  rate: number;
  orderQty: number;
  mcQty: number;
  prodOrdQty: number;
  /** prodOrdQty − balanceToProdEnt (@gmd/contract-review prodEntryQty); null when unknown. */
  prodEntryQty: number | null;
  /** Latest PROD ENTRY DUMP day, dd-MMM-yyyy. */
  prodEntryDate: string | null;
  diQty: number;
  billedQty: number;
  balBillAgMc: number;
  balBillAgMcVal: number;
  productionOrderNumber: string | null;
  offerNumber: string[];
  inspectionNumber: string[];
  diDate: string[];
};

export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * First unmet step for one contract line.
 * shortcut: a partly-billed line shows as Bill/Dispatch for the whole qty; split per quantity if asked.
 */
export function stageOf(l: Pick<ContractLine, "orderQty" | "prodOrdQty" | "diQty" | "billedQty" | "productionOrderNumber" | "offerNumber" | "inspectionNumber" | "diDate">): Stage {
  if (l.orderQty > 0 && l.billedQty >= l.orderQty) return "Done";
  if (l.diQty > l.billedQty || (l.diDate.length > 0 && l.billedQty < l.orderQty)) return "Bill";
  if (l.inspectionNumber.length > 0) return "Dispatch";
  if (l.offerNumber.length > 0) return "Inspection";
  if (l.prodOrdQty > 0 || l.productionOrderNumber) return "Production";
  return "Order";
}

/**
 * "Produced X of Y (last entry d)" for one contract: entry qty over prod order qty, both summed over
 * the lines on a production order whose entry qty is known; null when there are none.
 */
export function producedSummary(lines: Pick<ContractLine, "prodOrdQty" | "prodEntryQty" | "prodEntryDate">[]): string | null {
  const known = lines.filter((l) => l.prodEntryQty !== null && l.prodOrdQty > 0);
  if (known.length === 0) return null;
  const produced = known.reduce((sum, l) => sum + (l.prodEntryQty ?? 0), 0);
  const ordered = known.reduce((sum, l) => sum + l.prodOrdQty, 0);
  const last = lines
    .map((l) => l.prodEntryDate)
    .filter((d): d is string => parseGmdDate(d) !== null)
    .sort((a, b) => parseGmdDate(b)!.getTime() - parseGmdDate(a)!.getTime())[0];
  return `Produced ${produced} of ${ordered}${last ? ` (last entry ${last})` : ""}`;
}

/** Days since the contract date, or null when the date is unreadable. */
export function ageDays(dateOfContract: string | null, today: Date): number | null {
  const d = parseGmdDate(dateOfContract);
  return d ? Math.floor((today.getTime() - d.getTime()) / 86_400_000) : null;
}

export type Light = "green" | "amber" | "red";
/** shortcut: no promised delivery date is stored, so age since contract stands in (≤60 green, ≤120 amber); switch to delivery date once synced. */
export function lightOf(stage: Stage, days: number | null): Light {
  if (stage === "Done" || days === null || days <= 60) return "green";
  return days <= 120 ? "amber" : "red";
}

/** Ready-to-bill amount for a line: the sheet's own value, else balance qty x rate. */
export const readyValue = (l: Pick<ContractLine, "balBillAgMc" | "balBillAgMcVal" | "rate">): number =>
  l.balBillAgMc > 0 ? l.balBillAgMcVal || l.balBillAgMc * l.rate : 0;

export type SaleLine = {
  invoiceNo: string;
  month: string | null; // YYYY-MM
  party: string;
  valveType: string;
  size: string;
  pressureClass: string;
  qty: number;
  value: number;
  /** qty × unit cost (lib/lineCost.ts); null = cost missing, never zero. */
  cost: number | null;
  /** Minimum VA% for the valve type (lib/vaRules.ts); 0 when no rule applies. */
  minVa: number;
  /** qty × the Quotation app's cost for the contract line; null when there is none. */
  quotedCost: number | null;
};

/**
 * qty, sales value and the (quoted) cost of one invoice line. A blank sales value is as unknown as
 * a blank cost: SALE BILL inserts carry no value until MASTER covers them, and costing such a line
 * against ₹0 of sales would invent a loss. So the cost is null unless qty, value and rate all exist.
 */
export function saleMoney(quantity: string | null, value: string | null, unitCost: number | null, quotedUnitCost: number | null): Pick<SaleLine, "qty" | "value" | "cost" | "quotedCost"> {
  const qty = num(quantity);
  const priced = Number.isFinite(parseFloat(String(value ?? "").replace(/,/g, "").trim()));
  const times = (unit: number | null) => (priced && qty > 0 && unit !== null ? qty * unit : null);
  return { qty, value: num(value), cost: times(unitCost), quotedCost: times(quotedUnitCost) };
}

/** Running totals of one Sales Register cell: a group × month, a group's Total, or All. */
export type GpCell = {
  lines: number;
  sales: number;
  /** Lines with no cost: their sales count in `sales`, never in GP. */
  missingLines: number;
  missingSales: number;
  /** Sales and cost of the costed lines, and Σ sales × min VA% ÷ 100 over them. */
  costedSales: number;
  cost: number;
  minGp: number;
  /** Sales and quoted cost of the lines the Quotation app has a cost for. */
  quotedSales: number;
  quotedCost: number;
};

export const emptyCell = (): GpCell => ({
  lines: 0, sales: 0, missingLines: 0, missingSales: 0, costedSales: 0, cost: 0, minGp: 0, quotedSales: 0, quotedCost: 0,
});

/** Adds one line to a cell (in place). Every total, All included, is built this way, never from percentages. */
export function addLine(c: GpCell, l: Pick<SaleLine, "value" | "cost" | "minVa" | "quotedCost">): GpCell {
  c.lines++;
  c.sales += l.value;
  if (l.cost === null) {
    c.missingLines++;
    c.missingSales += l.value;
  } else {
    c.costedSales += l.value;
    c.cost += l.cost;
    c.minGp += (l.value * l.minVa) / 100;
  }
  if (l.quotedCost !== null) {
    c.quotedSales += l.value;
    c.quotedCost += l.quotedCost;
  }
  return c;
}

/**
 * GP = sales − cost and GP % = GP ÷ sales × 100, over the costed lines only (weighted); null when
 * the cell has no costed line. Red: GP below the sales-weighted minimum VA% of those lines.
 */
export function gpOf(c: GpCell): { gp: number | null; gpPct: number | null; red: boolean; quotedGpPct: number | null } {
  const gp = c.lines > c.missingLines ? c.costedSales - c.cost : null;
  return {
    gp,
    gpPct: gp !== null && c.costedSales !== 0 ? (gp * 100) / c.costedSales : null,
    red: gp !== null && gp < c.minGp,
    quotedGpPct: c.quotedSales !== 0 ? ((c.quotedSales - c.quotedCost) * 100) / c.quotedSales : null,
  };
}

/**
 * Sales Register valve type: the item master's type for the code (FullItem.itemType, else
 * RawMaterial.l2ValveType), else the sheet's label read through the keyword patterns, else
 * the label as written, else "-".
 */
export function valveTypeOf(itemMasterType: string | null | undefined, sheetLabel: string): string {
  return itemMasterType?.trim() || matchItemType(sheetLabel) || sheetLabel.trim() || "-";
}

/** "12-Apr-26" / ISO -> "2026-04"; null when unreadable. */
export function monthKey(date: string | null): string | null {
  const d = parseGmdDate(date);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : null;
}

/** The 12 month keys of a fiscal year label like "2026-27", April first. */
export function fiscalMonths(fy: string): string[] {
  const start = parseInt(fy.slice(0, 4), 10);
  return Array.from({ length: 12 }, (_, i) => {
    const m = (3 + i) % 12;
    return `${m < 3 ? start + 1 : start}-${String(m + 1).padStart(2, "0")}`;
  });
}
