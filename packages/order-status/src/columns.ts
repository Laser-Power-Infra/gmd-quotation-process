import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Order Status: one row per contract, from the ContractReview lines the hourly job fills from the
// GMD EXECUTION TRACKING / CONTRACTS sheets (order, MC, prod order, offer, inspection, DI and billed
// quantities); invoices come from SupplyHistoryItem. Every per-column rule lives here and the SQL
// accepts only the keys listed. Plain TS: imported by the SQL builder, the slice and the client page.

/** The steps in order. A line sits at its first unmet one; a contract at its least-advanced line. */
export const STAGES = ["Order", "Production", "Inspection", "Dispatch", "Bill", "Fully billed"] as const;
export type Stage = (typeof STAGES)[number];

/** Who the line is waiting on at each stage. */
export const PENDING_WITH: Record<Stage, string> = {
  Order: "Planning (production order)",
  Production: "Production",
  Inspection: "QA / customer inspector",
  Dispatch: "Dispatch (DI awaited)",
  Bill: "Accounts (billing)",
  "Fully billed": "-",
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

export interface ContractRow {
  /** The contract no. */
  id: string;
  contractNo: string;
  party: string;
  /** yyyy-mm-dd; null when the sheet date is unreadable. */
  contractDate: string | null;
  /** Days since the contract date. */
  days: number | null;
  items: number;
  /** Σ order qty × rate over the lines. */
  value: number;
  stage: Stage;
  pendingWith: string;
  /** Σ prod entry qty and Σ prod order qty over the lines on a production order whose entry qty is known; null when none. */
  producedQty: number | null;
  producedOf: number | null;
  /** Latest PROD ENTRY day as the sheet writes it. */
  lastEntry: string | null;
}

/** One line of a contract, for the drill-down. */
export interface ContractLineRow {
  id: string;
  itemCode: string;
  itemName: string;
  orderQty: number;
  mcQty: number;
  prodOrdQty: number;
  diQty: number;
  billedQty: number;
  productionOrderNumber: string | null;
  offerNumber: string[];
  inspectionNumber: string[];
  diDate: string[];
  stage: Stage;
}

export interface InvoiceLine {
  invoiceNo: string;
  date: string | null;
  itemName: string;
  itemCode: string | null;
  qty: string | null;
  value: string | null;
  lrNoDt: string | null;
  orderCopy: string | null;
  invoice: string | null;
  inspectionReport: string | null;
}

/** The paper trail of one contract: its lines, then the invoices raised against it. */
export interface ContractDetail {
  lines: ContractLineRow[];
  invoices: InvoiceLine[];
}

export interface OrderStatusMeta {
  /** Contracts per stage under every filter but the stage one, so a stage tile keeps its figure once picked. */
  stages: Record<Stage, number>;
  /** Latest ContractReview sync. */
  syncedAt: string | null;
}
export type OrderStatusPageData = TablePage<ContractRow, OrderStatusMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth. `extra.showDone` lists fully billed contracts. */
export interface OrderStatusActions {
  loadPage: (query: TableQuery) => Promise<Result<OrderStatusPageData>>;
  loadFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
  loadContract: (contractNo: string) => Promise<Result<ContractDetail>>;
  /** One CSV row per line of every contract the query keeps, in EXPORT_HEADER order. */
  loadExport: (query: TableQuery) => Promise<Result<(string | number | null)[][]>>;
}

export const ORDER_COLUMNS: DataColumn<ContractRow>[] = [
  { key: "contractNo", label: "Contract no", kind: "text", filter: true, sortable: true, sticky: true, width: 180 },
  { key: "party", label: "Party", kind: "text", filter: true, sortable: true, width: 260 },
  { key: "contractDate", label: "Contract date", kind: "date", filter: true, sortable: true, width: 130 },
  { key: "items", label: "Items", kind: "number", sortable: true, align: "right", width: 80 },
  { key: "value", label: "Order value", kind: "number", sortable: true, align: "right", width: 130 },
  // Sorts in step order, not alphabetically.
  { key: "stage", label: "Where it is", kind: "text", filter: true, sortable: true, width: 300 },
  { key: "pendingWith", label: "Pending with", kind: "text", filter: true, sortable: true, width: 210 },
];

export const EXPORT_HEADER = [
  "Contract no", "Party", "Contract date", "Item code", "Item", "Order qty", "MC qty", "Prod order qty", "DI qty", "Billed qty",
  "Stage", "Pending with", "Prod order no", "Inspection offers", "Inspections", "DI dates",
];

/** "Produced X of Y (last entry d)"; null when no line on a production order has a known entry qty. */
export function producedText(r: Pick<ContractRow, "producedQty" | "producedOf" | "lastEntry">): string | null {
  if (r.producedQty === null || r.producedOf === null) return null;
  return `Produced ${r.producedQty} of ${r.producedOf}${r.lastEntry ? ` (last entry ${r.lastEntry})` : ""}`;
}

export type Light = "green" | "amber" | "red";
/** shortcut: no promised delivery date is stored, so age since contract stands in (≤60 green, ≤120 amber); switch to delivery date once synced. */
export function lightOf(stage: Stage, days: number | null): Light {
  if (stage === "Fully billed" || days === null || days <= 60) return "green";
  return days <= 120 ? "amber" : "red";
}
