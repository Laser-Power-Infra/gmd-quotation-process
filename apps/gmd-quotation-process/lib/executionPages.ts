/**
 * Pure logic for the Phase 1 execution pages (Order Status, Ready to Bill, Sales Register).
 *
 * Data comes from tables the hourly jobs already fill from the GMD EXECUTION TRACKING / CONTRACTS
 * sheets: `ContractReview` (db-tender; order, MC, prod order, offer, inspection, DI and billed
 * quantities) and `SupplyHistoryItem` (one row per invoice line, from SALE BILL / MASTER).
 */
import { parseGmdDate } from "./gmd_lib/dateParse";

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
};

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
