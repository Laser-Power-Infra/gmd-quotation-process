import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import { DIM_FIELDS, DISPATCH_FIELDS, ID_FIELDS, TEST_FIELDS, type ValveSerialField, type ValveSerialView, type ValveStandard } from "./fields";

// Every per-column rule of the Valve Serial table (label, kind, filter, sort)
// lives here; the SQL builder reads the same list. Plain TS: shared by the
// server, the slice and the client page.

export type ValveSerialRow = ValveSerialView & {
  id: string;
  heatEntryId: string | null;
  standard: ValveStandard | null;
  assignedBy: string | null;
  /** ISO timestamp. */
  updatedAt: string;
  /** First Supply History line with the same invoice no (exact match); null when none. */
  supplyParty: string | null;
  supplyContract: string | null;
  supplyDate: string | null;
  /** Stock row of a heat-entry serial, filled by the host from the stock DB; null = no heat-entry link. */
  stockCode: string | null;
  stockLocation: string | null;
  stockQty: string | null;
};

export type ValveSerialPageData = TablePage<ValveSerialRow>;

/** A serial assigned on the heat-entry form (structural subset of physical-stock's HeatSerial). */
export interface HeatSerialOption {
  id: string;
  serial_no: string;
  valve_type: string | null;
  size: string | null;
}

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server Actions the host passes in; the host owns auth and the stock-DB lookups. */
export interface ValveSerialActions {
  loadPage: (query: TableQuery) => Promise<Result<ValveSerialPageData>>;
  loadFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
  saveSerial: (id: string | null, input: Partial<ValveSerialView>) => Promise<{ success: boolean; error?: string }>;
  /** Standard values for the pre-fill button. */
  loadStandard: (input: Partial<ValveSerialView>) => Promise<ValveStandard>;
  /** Pickers: heat-entry serials, and the Flange tab's sizes and PN ratings. */
  loadOptions: () => Promise<{ serials: HeatSerialOption[]; sizes: string[]; pnRatings: string[] }>;
}

const NUMBER = new Set<string>([
  "sizeDn", "odMm", "idMm", "pcdMm", "boltHoles", "holeDiaMm", "flangeThicknessMm", "faceToFaceMm",
  "heightOpenMm", "heightClosedMm", "weightKg", "bodyTestPressure", "seatTestPressure",
]);
const DATE = new Set<string>(["testDate", "invoiceDate"]);

const fieldColumn = ([key, label]: readonly [ValveSerialField, string]): DataColumn<ValveSerialRow> => ({
  key,
  label,
  kind: DATE.has(key) ? "date" : NUMBER.has(key) ? "number" : "text",
  filter: true,
  sortable: true,
  sticky: key === "serialNo",
  align: NUMBER.has(key) ? "right" : "left",
  width: key === "serialNo" ? 170 : key === "itemName" || key === "partyName" ? 240 : undefined,
});

/** Columns the server filters and sorts: valve_serial fields plus the Supply History join. */
export const SQL_COLUMNS: DataColumn<ValveSerialRow>[] = [
  ...ID_FIELDS.map(fieldColumn),
  ...DISPATCH_FIELDS.map(fieldColumn),
  { key: "supplyParty", label: "Supply party", kind: "text", filter: true, sortable: true, width: 240 },
  { key: "supplyContract", label: "Supply contract", kind: "text", filter: true, sortable: true },
  { key: "supplyDate", label: "Supply date", kind: "date", filter: true, sortable: true },
  ...TEST_FIELDS.map(fieldColumn),
  ...DIM_FIELDS.map(fieldColumn),
  { key: "assignedBy", label: "Assigned by", kind: "text", filter: true, sortable: true },
];

/** Every column the table shows; the stock ones are host-filled, so never filtered or sorted. */
export const VALVE_SERIAL_COLUMNS: DataColumn<ValveSerialRow>[] = [
  ...SQL_COLUMNS,
  { key: "stockCode", label: "Stock ERP code", kind: "text" },
  { key: "stockLocation", label: "Stock location", kind: "text" },
  { key: "stockQty", label: "Stock available qty", kind: "number", align: "right" },
];
