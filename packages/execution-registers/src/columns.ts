import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Execution Registers: three server-paged tables on one page, one tab each. Every per-column rule
// (label, kind, filter, sort) lives here; the SQL accepts only the keys listed for its register.
// Plain TS: imported by the SQL builder, the slice and the client page.

export const REGISTER_KEYS = ["dispatch", "mc", "production"] as const;
export type RegisterKey = (typeof REGISTER_KEYS)[number];
export const isRegisterKey = (v: unknown): v is RegisterKey => REGISTER_KEYS.includes(v as RegisterKey);

/** One line; its fields are the column keys of its register. Dates are ISO yyyy-mm-dd. */
export type RegisterRow = { id: string } & Record<string, string | number | null>;

export interface KpiTile {
  key: string;
  label: string;
  format: "count" | "money" | "qty";
}

export interface RegisterDef {
  label: string;
  columns: DataColumn<RegisterRow>[];
  /** Totals over every line the filters keep, aggregated in SQL. */
  kpis: KpiTile[];
  searchPlaceholder: string;
  note: string;
}

export interface RegisterMeta {
  kpi: Record<string, number>;
  /** When the copy behind the register was last written. */
  syncedAt: string | null;
}
export type RegisterPageData = TablePage<RegisterRow, RegisterMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth. */
export interface ExecutionRegistersActions {
  loadPage: (register: RegisterKey, query: TableQuery) => Promise<Result<RegisterPageData>>;
  loadFacet: (register: RegisterKey, key: string, query: TableQuery) => Promise<Result<string[]>>;
}

const qty = (key: string, label: string, width = 100): DataColumn<RegisterRow> => ({ key, label, kind: "number", sortable: true, align: "right", width });

export const REGISTERS: Record<RegisterKey, RegisterDef> = {
  dispatch: {
    label: "Dispatch / LR",
    note: "Invoice lines from Supply History (SALE BILL + MASTER). An invoice without an LR no is LR pending.",
    searchPlaceholder: "Search invoice, party, contract, item, LR",
    kpis: [
      { key: "invoices", label: "Invoices", format: "count" },
      { key: "value", label: "Invoice value", format: "money" },
      { key: "lrPending", label: "Invoices without LR", format: "count" },
      { key: "parties", label: "Parties", format: "count" },
    ],
    columns: [
      { key: "invoiceNo", label: "Invoice no", kind: "text", filter: true, sortable: true, sticky: true, width: 140 },
      { key: "invoiceDate", label: "Invoice date", kind: "date", filter: true, sortable: true, width: 130 },
      { key: "fy", label: "FY", kind: "text", filter: true, sortable: true, width: 90 },
      { key: "party", label: "Party", kind: "text", filter: true, sortable: true, width: 240 },
      { key: "contractNo", label: "ERP contract no", kind: "text", filter: true, sortable: true, width: 150 },
      { key: "partyOrderNo", label: "Party PO no", kind: "text", sortable: true, width: 160 },
      { key: "itemCode", label: "Item code", kind: "text", filter: true, sortable: true, width: 130 },
      { key: "itemName", label: "Item name", kind: "text", sortable: true, width: 280 },
      qty("qty", "Qty", 90),
      { key: "uom", label: "UOM", kind: "text", filter: true, sortable: true, width: 90 },
      qty("value", "Value", 130),
      { key: "lrNoDt", label: "LR no & date", kind: "text", sortable: true, width: 200 },
      { key: "lrStatus", label: "LR status", kind: "text", filter: true, sortable: true, width: 120 },
      { key: "consignee", label: "Consignee", kind: "text", filter: true, sortable: true, width: 220 },
      { key: "destination", label: "Destination", kind: "text", filter: true, sortable: true, width: 160 },
      { key: "state", label: "State", kind: "text", filter: true, sortable: true, width: 140 },
    ],
  },
  mc: {
    label: "MC",
    note: "MC lines from the ERP MC tab. Balance = ordered − cancelled − billed; Open while it is above 0. The tab has no date column.",
    searchPlaceholder: "Search MC, contract, party, item, BOM",
    kpis: [
      { key: "mcs", label: "MCs", format: "count" },
      { key: "openLines", label: "Open lines", format: "count" },
      { key: "openValue", label: "Open balance value", format: "money" },
      { key: "billedValue", label: "Billed value", format: "money" },
    ],
    columns: [
      { key: "mcNo", label: "MC no", kind: "text", filter: true, sortable: true, sticky: true, width: 130 },
      { key: "slNo", label: "Line", kind: "number", align: "right", width: 70 },
      { key: "contractNo", label: "Sale contract no", kind: "text", filter: true, sortable: true, width: 150 },
      { key: "party", label: "Party", kind: "text", filter: true, sortable: true, width: 240 },
      { key: "itemCode", label: "Item code", kind: "text", filter: true, sortable: true, width: 130 },
      { key: "itemName", label: "Item name", kind: "text", sortable: true, width: 280 },
      { key: "partyItemName", label: "Party item name", kind: "text", sortable: true, width: 220 },
      { key: "bomId", label: "BOM ID", kind: "text", filter: true, sortable: true, width: 140 },
      qty("orderedQty", "Ordered"),
      qty("cancelledQty", "Cancelled"),
      qty("billedQty", "Billed"),
      qty("balanceQty", "Balance"),
      qty("rate", "Rate", 110),
      qty("balanceValue", "Balance value", 130),
      qty("inspOfferedQty", "Offered for insp.", 130),
      qty("inspectedQty", "Inspected", 100),
      { key: "status", label: "Status", kind: "text", filter: true, sortable: true, width: 100 },
    ],
  },
  production: {
    label: "Production",
    note: "Production orders from the ERP PROD ORDER DUMP; produced = the PROD ENTRY DUMP receipts against the same order and item.",
    searchPlaceholder: "Search prod order, MC, contract, party, item",
    kpis: [
      { key: "orders", label: "Production orders", format: "count" },
      { key: "pending", label: "Pending lines", format: "count" },
      { key: "pendingQty", label: "Qty still to produce", format: "qty" },
      { key: "producedQty", label: "Qty produced", format: "qty" },
    ],
    columns: [
      { key: "prodOrderNo", label: "Prod order no", kind: "text", filter: true, sortable: true, sticky: true, width: 140 },
      { key: "prodOrderDate", label: "Order date", kind: "date", filter: true, sortable: true, width: 130 },
      { key: "mcNo", label: "MC no", kind: "text", filter: true, sortable: true, width: 130 },
      { key: "contractNo", label: "Sale contract no", kind: "text", filter: true, sortable: true, width: 150 },
      { key: "party", label: "Party", kind: "text", filter: true, sortable: true, width: 240 },
      { key: "itemCode", label: "Item code", kind: "text", filter: true, sortable: true, width: 130 },
      { key: "itemName", label: "Item name", kind: "text", sortable: true, width: 280 },
      { key: "bomId", label: "BOM ID", kind: "text", filter: true, sortable: true, width: 140 },
      qty("orderedQty", "Ordered"),
      qty("producedQty", "Produced"),
      qty("balanceQty", "Balance"),
      qty("entries", "Entries", 90),
      { key: "lastEntryDate", label: "Last entry", kind: "date", filter: true, sortable: true, width: 130 },
      { key: "status", label: "Status", kind: "text", filter: true, sortable: true, width: 110 },
    ],
  },
};
