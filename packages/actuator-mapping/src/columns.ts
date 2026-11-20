import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { formatCell } from "@gmd/ui/components/data-table/format";

// Actuator & Gearbox Mapping: three server-paged views on one page, one tab each. Mapping and
// Suitability read the same mapping rows (the matrix shows its marks); Stock reads the actuator and
// gearbox stock lines with the old mismatch report's checks. Every per-column rule (label, kind,
// filter, sort) lives here; the SQL accepts only the keys listed for its view.
// Plain TS: imported by the SQL builder, the slice and the client page.

export const VIEW_KEYS = ["mapping", "suitability", "stock"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];
export const isViewKey = (v: unknown): v is ViewKey => VIEW_KEYS.includes(v as ViewKey);

export type Make = "AUMA" | "Rotork" | "GMD";
export type MakeFilter = Make | "ALL";
export const MAKES: { value: MakeFilter; label: string }[] = [
  { value: "ALL", label: "All makes" },
  { value: "AUMA", label: "AUMA" },
  { value: "Rotork", label: "Rotork" },
  { value: "GMD", label: "GMD gearbox" },
];

/** One line; its fields are the column keys of its view. Quantities and torques are numbers. */
export type Row = { id: string } & Record<string, string | number | null>;

/** A column; `make` columns hide while the page-wide Make picks another make. */
export type Column = DataColumn<Row> & { make?: Make };

export interface KpiTile {
  key: string;
  label: string;
  format: "count" | "qty" | "money";
  /** Clicking the tile sets these column filters: the old mismatch report's sections. */
  filters?: Record<string, string[]>;
}

export interface ViewDef {
  label: string;
  columns: Column[];
  /** Totals over every line the filters keep, aggregated in SQL. */
  kpis: KpiTile[];
  searchPlaceholder: string;
  note: string;
}

/** One actuator / gearbox column of the suitability matrix. */
export interface SuitCode {
  code: string;
  kind: string;
  make: string;
  label: string;
  ratingNm: number | null;
  /** Live available qty; null when Physical Stock could not be read or no stock line carries the code. */
  stock: number | null;
}

export interface PageMeta {
  /** Set when live Physical Stock could not be read: the live quantities are blank. */
  stockError: string | null;
  kpi: Record<string, number>;
  /** Suitability only: the matrix columns, and the marks of the rows on the page by map key, then code. */
  codes?: SuitCode[];
  marks?: Record<string, Record<string, string>>;
}
export type PageData = TablePage<Row, PageMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth. */
export interface ActuatorMappingActions {
  loadPage: (view: ViewKey, query: TableQuery) => Promise<Result<PageData>>;
  loadFacet: (view: ViewKey, key: string, query: TableQuery) => Promise<Result<string[]>>;
}

/** Check column values: the workbook checks the old mismatch report listed. */
export const ERP_DIFFERS = "ERP stock differs from physical";
export const NEEDS_CODE = "Needs ERP code";

const text = (key: string, label: string, width: number, extra: Partial<Column> = {}): Column => ({ key, label, kind: "text", filter: true, sortable: true, width, ...extra });
const num = (key: string, label: string, width: number, extra: Partial<Column> = {}): Column => ({ key, label, kind: "number", filter: true, sortable: true, align: "right", width, ...extra });
/** Live Physical Stock qty: sortable, never filtered (it is read from another database per request). */
const live = (key: string, label: string, width: number, extra: Partial<Column> = {}): Column => num(key, label, width, { filter: false, ...extra });

const MAPPING_COLUMNS: Column[] = [
  text("valveType", "Valve type", 170, { sticky: true }),
  num("dn", "DN", 80, { sticky: true }),
  text("pn", "PN", 90, { sticky: true }),
  num("requiredTorque", "Required torque (Nm)", 160),
  text("gearbox", "AUMA gearbox", 180),
  num("actInputTorque", "Actuator input torque (Nm)", 190),
  text("aumaModel", "AUMA SA model", 140, { make: "AUMA" }),
  text("rotorkModel", "Rotork model", 130, { make: "Rotork" }),
  num("stockRotorkNm", "In-stock Rotork K-series (Nm)", 210, {
    make: "Rotork",
    render: (r) => (r.stockRotorkNm === null ? "none" : formatCell(r.stockRotorkNm, "number")),
  }),
  live("rotorkAvailable", "K-series available", 140, { make: "Rotork" }),
  text("valveFlange", "Valve top flange", 140),
  text("flangeCheck", "Flange check", 170),
  text("gmdGbCode", "GMD stock gearbox", 160, { make: "GMD" }),
  num("gmdGbRating", "GMD gearbox rating (Nm)", 190, { make: "GMD" }),
  live("gmdGbAvailable", "GMD gearbox available", 170, { make: "GMD" }),
];

const SUITABILITY_KEYS = ["valveType", "dn", "pn", "requiredTorque"];

export const VIEWS: Record<ViewKey, ViewDef> = {
  mapping: {
    label: "Mapping",
    note: "Valve type, size and pressure mapped to gearbox and actuator. Available quantities are live Physical Stock.",
    searchPlaceholder: "Search valve type, PN, gearbox, model, flange",
    kpis: [],
    columns: MAPPING_COLUMNS,
  },
  suitability: {
    label: "Suitability",
    note: "✔ suitable · ○ oversized · blank = too small · n/a = not applicable. Column heads show the rating and live stock.",
    searchPlaceholder: "Search valve type, DN, PN",
    kpis: [],
    columns: MAPPING_COLUMNS.filter((c) => SUITABILITY_KEYS.includes(c.key)),
  },
  stock: {
    label: "Stock",
    note: "ERP stock, physical and workbook available are the imported workbook snapshot (STOCK_ACT / GMD_GB_STOCK). Available now is live Physical Stock. Read-only.",
    searchPlaceholder: "Search ERP code, make, rating, remarks",
    kpis: [
      { key: "actuators", label: "Actuator lines", format: "count" },
      { key: "rotork", label: "Rotork K-series lines", format: "count" },
      { key: "auma", label: "AUMA SA lines", format: "count" },
      { key: "units", label: "Actuator units (workbook)", format: "qty" },
      { key: "value", label: "Actuator stock value", format: "money" },
      { key: "erpDiffers", label: "ERP stock differs from physical", format: "count", filters: { check: [ERP_DIFFERS] } },
      { key: "gbCoded", label: "Gearboxes with an ERP code", format: "count", filters: { kind: ["Gearbox"], check: [BLANK] } },
      { key: "needsCode", label: "Gearbox lines needing an ERP code", format: "count", filters: { check: [NEEDS_CODE] } },
      { key: "torqueToFill", label: "AUMA SA torque to fill", format: "count", filters: { kind: ["Actuator"], make: ["AUMA"], torque: [BLANK] } },
    ],
    columns: [
      text("erpCode", "ERP code", 140, { sticky: true }),
      text("kind", "Item", 100),
      text("make", "Make", 100),
      text("ratingCode", "Rating / type", 170),
      num("torque", "Torque (Nm)", 120, { render: (r) => (r.torque === null ? "to fill" : formatCell(r.torque, "number")) }),
      live("live", "Available now", 130),
      num("stockPerErp", "ERP stock", 110),
      num("physicalSum", "Physical", 110),
      num("available", "Available (workbook)", 160),
      text("check", "Check", 230),
      text("remarks", "Remarks", 240),
    ],
  },
};
