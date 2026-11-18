import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Service / Work Orders: the purchase order lines whose item is a service code (ITEM MASTER ERP),
// with their GRN receipts. Every per-column rule (label, kind, filter, sort) lives here; the SQL
// accepts only the keys listed. Plain TS: imported by the SQL builder, the slice and the client page.

/** One PO line. Dates are ISO yyyy-mm-dd. */
export interface ServiceOrderRow {
  id: string;
  orderNo: string;
  lineNo: string;
  orderDate: string | null;
  /** Days since the order date, while anything is pending. */
  daysPending: number | null;
  /** Supplier name, else its code. */
  supplier: string;
  serviceCode: string;
  serviceName: string;
  ordered: number | null;
  received: number | null;
  pending: number;
  um: string;
  rate: number | null;
  /** pending x rate x exchange rate (1 when blank); null without a rate. */
  pendingValue: number | null;
  dueDate: string | null;
  grnCount: number;
  lastGrnNo: string;
  lastGrnDate: string | null;
  lastBillNo: string;
  /** Still pending and past its due date. */
  overdue: boolean;
}

type Column = DataColumn<ServiceOrderRow>;
const text = (key: string, label: string, width: number): Column => ({ key, label, kind: "text", filter: true, sortable: true, width });
const num = (key: string, label: string, width = 110): Column => ({ key, label, kind: "number", filter: true, sortable: true, align: "right", width });
const date = (key: string, label: string): Column => ({ key, label, kind: "date", filter: true, sortable: true, width: 130 });

// Number filters match the value as text, rounded to 2 places.
export const COLUMNS: Column[] = [
  // Shows "order/line"; its filter lists order numbers, so one pick keeps every line of that order.
  { ...text("orderNo", "Order no", 160), sticky: true },
  date("orderDate", "Order date"),
  num("daysPending", "Days pending"),
  text("supplier", "Supplier", 240),
  text("serviceCode", "Service code", 130),
  text("serviceName", "Service", 260),
  num("ordered", "Ordered"),
  num("received", "Received"),
  num("pending", "Pending"),
  text("um", "Unit", 80),
  num("rate", "Rate"),
  num("pendingValue", "Pending value", 130),
  date("dueDate", "Due date"),
  num("grnCount", "Receipts (GRN)", 120),
  text("lastGrnNo", "Last GRN", 140),
  date("lastGrnDate", "Last GRN date"),
  text("lastBillNo", "Supplier bill no", 160),
];

export interface KpiTile {
  key: string;
  label: string;
  money?: boolean;
  danger?: boolean;
}

/** Tiles over the open lines the filters keep, aggregated in SQL. */
export const KPIS: KpiTile[] = [
  { key: "openLines", label: "Open orders" },
  { key: "pendingValue", label: "Value still to be received", money: true },
  { key: "overdueLines", label: "Past due date", danger: true },
  { key: "over30Lines", label: "Pending over 30 days", danger: true },
  { key: "noReceiptLines", label: "No receipt yet" },
];

export interface ServiceOrdersMeta {
  /** KPIS figures by key. */
  kpi: Record<string, number>;
  /** Service order lines before any filter; 0 shows the empty state. */
  allLines: number;
  /** Service codes on file; 0 = the service-orders sync has not run. */
  serviceCodes: number;
  /** When the service code list was last synced. */
  syncedAt: string | null;
}

/** The two toggles above the table. Off by default: open lines only, any due date. */
export interface ServiceOrdersExtra {
  showClosed?: boolean;
  overdueOnly?: boolean;
}

export type ServiceOrdersQuery = TableQuery & { extra?: ServiceOrdersExtra };
export type ServiceOrdersPageData = TablePage<ServiceOrderRow, ServiceOrdersMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth. */
export interface ServiceOrdersActions {
  loadPage: (query: ServiceOrdersQuery) => Promise<Result<ServiceOrdersPageData>>;
  loadFacet: (key: string, query: ServiceOrdersQuery) => Promise<Result<string[]>>;
}
