import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Purchases v2: one table row per PO, lines in the drill-down. Every per-column
// rule (label, kind, filter, sort) lives here; the server reads the same list.
// Plain TS: imported by the SQL builder, the slice and the client page.

/** What a supplier is owed, from the Creditors ledger (host-filled; null = not looked up). */
export interface SupplierPayable {
  bills: number;
  advances: number;
  net: number;
  overdue: number;
  over180: number;
}

export const DELIVERY_STATUSES = ["Overdue", "Due in 30 days", "Later", "No date", "Received"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface PoRow {
  poNo: string;
  /** ISO yyyy-mm-dd. */
  poDate: string | null;
  supplierCode: string;
  supplier: string;
  origin: "Import" | "Domestic";
  lines: number;
  openLines: number;
  /** Balance quantity per unit, e.g. "800 PCS, 120 KG". Units are never added together. */
  balance: string | null;
  orderedValue: number;
  openValue: number;
  receivedPct: number | null;
  /** Earliest delivery date among the open lines. */
  due: string | null;
  daysOverdue: number | null;
  /** Worst status among the PO's lines. */
  status: DeliveryStatus;
  /** Linked sales contracts, comma-joined. */
  contract: string | null;
  payable?: SupplierPayable | null;
}

export interface PoLine {
  id: string;
  lineNo: string;
  itemCode: string;
  itemName: string | null;
  uom: string;
  ordered: number | null;
  received: number | null;
  balance: number;
  rate: number | null;
  lastRate: number | null;
  minRate: number | null;
  /** Balance x rate; null when the rate is blank. */
  openValue: number | null;
  due: string | null;
  daysOverdue: number | null;
  status: DeliveryStatus;
  contract: string;
}

export interface ChartBar {
  label: string;
  value: number;
  lines: number;
  /** Supplier chart only. */
  code?: string;
  payable?: SupplierPayable | null;
}

export interface PurchaseMeta {
  kpi: {
    openLines: number;
    /** Ordered value of the lines still open. */
    openPoValue: number;
    /** Balance qty x rate: what is still to arrive. */
    inTransitValue: number;
    overdueLines: number;
    overdueValue: number;
    due30Lines: number;
    due30Value: number;
    suppliers: number;
    untaggedLines: number;
    untaggedValue: number;
    /** Open lines with no usable rate/value: counted, valued at 0. */
    blankValueLines: number;
  };
  ageing: ChartBar[];
  suppliers: ChartBar[];
  monthly: ChartBar[];
  syncedAt: string | null;
}

export type PurchaseQuery = TableQuery & { extra?: { openOnly?: boolean } };
export type PurchasePageData = TablePage<PoRow, PurchaseMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth and the Creditors lookup. */
export interface PurchaseV2Actions {
  loadPage: (query: PurchaseQuery) => Promise<Result<PurchasePageData>>;
  loadFacet: (key: string, query: PurchaseQuery) => Promise<Result<string[]>>;
  loadLines: (poNo: string, query: PurchaseQuery) => Promise<Result<PoLine[]>>;
}

/** Slicers on the left: line-level fields, each a server facet. */
export const SLICERS: readonly { key: string; label: string }[] = [
  { key: "supplier", label: "Supplier" },
  { key: "origin", label: "Import / domestic" },
  { key: "poYear", label: "PO year" },
  { key: "status", label: "Delivery status" },
  { key: "contract", label: "Sales contract" },
  // Not a purchase column: the host resolves party <-> contract from Contract Review.
  { key: "party", label: "Party" },
];

/** Supplier payment outstanding (Creditors), one table column per figure. */
export const PAYABLE_COLUMNS: readonly { key: string; label: string; field: keyof SupplierPayable }[] = [
  { key: "payableBills", label: "Bills", field: "bills" },
  { key: "payableAdvances", label: "Advances", field: "advances" },
  { key: "payableNet", label: "Net payable", field: "net" },
  { key: "payableOverdue", label: "Payable overdue", field: "overdue" },
  { key: "payableOver180", label: "Payable 180+ days", field: "over180" },
];

export const PO_COLUMNS: DataColumn<PoRow>[] = [
  { key: "poNo", label: "PO no", kind: "text", filter: true, sortable: true, sticky: true, width: 130 },
  { key: "poDate", label: "PO date", kind: "date", filter: true, sortable: true, width: 120 },
  { key: "supplier", label: "Supplier", kind: "text", filter: true, sortable: true, width: 240 },
  { key: "origin", label: "Origin", kind: "text", filter: true, sortable: true, width: 110 },
  { key: "status", label: "Delivery status", kind: "text", filter: true, sortable: true, width: 140 },
  { key: "due", label: "Delivery date", kind: "date", filter: true, sortable: true, width: 130 },
  { key: "daysOverdue", label: "Days overdue", kind: "number", sortable: true, align: "right", width: 120 },
  { key: "lines", label: "Lines", kind: "number", sortable: true, align: "right", width: 80 },
  { key: "balance", label: "Balance qty", kind: "text", width: 180 },
  { key: "receivedPct", label: "Received %", kind: "number", sortable: true, align: "right", width: 110 },
  { key: "orderedValue", label: "PO value", kind: "number", sortable: true, align: "right", width: 130 },
  { key: "openValue", label: "Open value", kind: "number", sortable: true, align: "right", width: 130 },
  { key: "contract", label: "Sales contract", kind: "text", filter: true, sortable: true, width: 180 },
  ...PAYABLE_COLUMNS.map((p) => ({ key: p.key, label: p.label, kind: "number" as const, align: "right" as const, width: 140 })),
];
