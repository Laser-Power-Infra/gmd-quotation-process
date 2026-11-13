/**
 * "GMD DISPATCH SL NO" workbook -> `valve_serial` (scripts/import-dispatch-serials.ts).
 *
 * The master tab carries the dispatch details (party, invoice, actuator, gearbox);
 * the seven type tabs carry the pre-numbered serials per valve type. Tabs are read
 * by gid and columns by exact header name, so a renamed column aborts the import
 * instead of silently dropping data. Rows are merged by serial: the first row seen
 * wins (master first), later rows only fill its blanks, and differences are reported.
 */
import { mpaToBar } from "@gmd/valve-serial/fields";
import { cell, requireColumns } from "./gmd_lib/bomMastErp";

export const DISPATCH_SPREADSHEET_ID = "1MxdGu9ka2Oohs_fvjb2-rX_2orM156Hw533Fm7UGG5s";

export type DispatchField =
  | "serialNo" | "contractNo" | "partyName" | "itemCode" | "itemName" | "valveType" | "sizeDn" | "pnRating"
  | "actuatorModel" | "actuatorSerial" | "invoiceDate" | "invoiceNo" | "heatNo" | "remarks" | "gearboxSerial" | "gearboxModel";
export type DispatchRecord = Partial<Record<DispatchField, string>> & { serialNo: string };

export interface DispatchTab {
  gid: number;
  /** Valve type of every row: the type tabs have no ITEM column. */
  valveType?: string;
  /** Field -> header exactly as the sheet has it (checked 12 Nov 2026). */
  columns: Partial<Record<DispatchField, string>> & { serialNo: string };
  /** 0-based index of a remarks column the sheet keeps without a header; read by position. */
  remarksAt?: number;
}

export const DISPATCH_TABS: DispatchTab[] = [
  {
    gid: 0, // master sheet dispatch
    columns: {
      contractNo: "CONTRACT NO", partyName: "PARTY NAME", itemCode: "ITEM CODE", itemName: "ITEM NAME", valveType: "ITEM",
      sizeDn: "SIZE(MM)", actuatorModel: "ACTUATOR- MODEL NO", actuatorSerial: "ACTUATOR-SR NO", serialNo: "SL NO - VALVE",
      invoiceDate: "DATE OF INVOICE", invoiceNo: "INVOICE NO", heatNo: "HEAT NO", remarks: "OTHER REMARKS",
      gearboxSerial: "GEAR BOX-SR NO", gearboxModel: "GEAR- MODEL NO",
    },
  },
  {
    gid: 1960097486,
    valveType: "SLUICE VALVE",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM NAME", sizeDn: "SIZE IN MM", pnRating: "PN RATING", invoiceNo: "INVOICE NO", serialNo: "SL.NO", heatNo: "HEAT NO" },
  },
  {
    gid: 1250830554,
    valveType: "BUTTERFLY VALVE",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM NAME", sizeDn: "SIZE IN MM", pnRating: "PN RATING", invoiceNo: "INVOICE NO", serialNo: "SL.NO", remarks: "REMARKS" },
  },
  {
    gid: 1781187734, // header on row 2, no PN column
    valveType: "PRV",
    columns: { itemCode: "ITEM_CODE", sizeDn: "size", itemName: "ITEM_NAME", invoiceNo: "VRNO", serialNo: "sl no", heatNo: "HEAT NO" },
  },
  {
    gid: 617957153,
    valveType: "FOOT VALVE",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM NAME", sizeDn: "SIZE IN MM", pnRating: "PN RATING", serialNo: "SL.NO", invoiceNo: "INVOICE NO", heatNo: "HEAT NO" },
  },
  {
    gid: 1527881089,
    valveType: "KNIFE GATE VALVE",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM_NAME", sizeDn: "SIZE", pnRating: "PN RATING", serialNo: "SI.NO", invoiceNo: "INVOICE NO", heatNo: "HEAT NO" },
    remarksAt: 8, // column I, e.g. "SENT FOR EXHIBITION"
  },
  {
    gid: 1690377724,
    valveType: "NRV-SWING",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM_NAME", sizeDn: "SIZE IN MM", pnRating: "PN RATING", serialNo: "SI.NO", invoiceNo: "INVOICE NO" },
  },
  {
    gid: 1984285985,
    valveType: "DPCV",
    columns: { itemCode: "ITEM CODE", itemName: "ITEM NAME", sizeDn: "SIZE IN MM", pnRating: "PN RATING", serialNo: "SL.NO", invoiceNo: "INVOICE NO", heatNo: "HEAT NO" },
  },
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "3-Dec-2025" and "29-11-2025" (day first) -> "2025-12-03"; anything else, or no such day, stays as typed. */
export function isoDate(raw: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})$/.exec(raw.trim());
  if (!m) return raw;
  const [day, year] = [Number(m[1]), Number(m[3])];
  const month = /\d/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].toUpperCase()) + 1;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return raw;
  return d.toISOString().slice(0, 10);
}

/**
 * One tab's rows as records. The header is the first non-blank row (PRV starts
 * with an empty row). PN is stored in bar ("1.6" MPa -> "16"), the spelling of the
 * app's PN picker (Technicals Flange tab). Rows with text but no valve serial (the
 * actuator-only rows of the master tab) come back in `noSerial` for the report.
 */
export function parseDispatchTab(
  tab: DispatchTab,
  read: { tabTitle: string; headers: string[]; rows: string[][] },
): { records: DispatchRecord[]; noSerial: string[][] } {
  const all = [read.headers, ...read.rows];
  const at = all.findIndex((r) => r.some((c) => String(c ?? "").trim()));
  const fields = Object.keys(tab.columns) as DispatchField[];
  const head = at < 0 ? [] : all[at];
  const idx = requireColumns(head, fields.map((f) => tab.columns[f]!), read.tabTitle);
  const remarksAt = tab.remarksAt ?? -1;
  // A header over the positional column means the sheet changed: stop rather than import the wrong column.
  if (cell(head, remarksAt)) throw new Error(`Sheet "${read.tabTitle}" has a header "${cell(head, remarksAt)}" over the unheaded remarks column; map it by name.`);
  const records: DispatchRecord[] = [];
  const noSerial: string[][] = [];
  for (const row of all.slice(at + 1)) {
    const rec: Partial<Record<DispatchField, string>> = tab.valveType ? { valveType: tab.valveType } : {};
    fields.forEach((f, i) => {
      const v = cell(row, idx[i]);
      if (v) rec[f] = f === "invoiceDate" ? isoDate(v) : f === "pnRating" ? mpaToBar(v) : v;
    });
    const remark = cell(row, remarksAt);
    if (remark) rec.remarks = remark;
    if (rec.serialNo) records.push(rec as DispatchRecord);
    else if (row.some((c) => String(c ?? "").trim())) noSerial.push(row);
  }
  return { records, noSerial };
}

export interface Conflict {
  serialNo: string;
  field: DispatchField;
  kept: string;
  ignored: string;
  /** Tab whose value was ignored, or "database" when the stored value was kept. */
  where: string;
}

// Case and spacing differences ("Sluice Valve" / "SLUICE  VALVE") are not conflicts.
const norm = (v: string) => v.replace(/\s+/g, " ").trim().toUpperCase();

/** `rec`'s values for the fields blank in `cur`, and the fields where both hold different values. */
function compare(cur: Record<string, unknown>, rec: DispatchRecord) {
  const fill: Partial<Record<DispatchField, string>> = {};
  const clash: [DispatchField, string, string][] = [];
  for (const [f, v] of Object.entries(rec) as [DispatchField, string][]) {
    const c = String(cur[f] ?? "").trim();
    if (!c) fill[f] = v;
    else if (norm(c) !== norm(v)) clash.push([f, c, v]);
  }
  return { fill, clash };
}

/** One record per serial across the tabs, in tab order. */
export function mergeBySerial(tabs: { source: string; records: DispatchRecord[] }[]) {
  const bySerial = new Map<string, DispatchRecord>();
  const conflicts: Conflict[] = [];
  for (const { source, records } of tabs) {
    for (const rec of records) {
      const prev = bySerial.get(rec.serialNo);
      if (!prev) {
        bySerial.set(rec.serialNo, { ...rec });
        continue;
      }
      const { fill, clash } = compare(prev, rec);
      Object.assign(prev, fill);
      for (const [field, kept, ignored] of clash) conflicts.push({ serialNo: rec.serialNo, field, kept, ignored, where: source });
    }
  }
  return { bySerial, conflicts };
}

/** New serials are created; existing rows only get their blank fields filled, and a differing value is reported, never written. */
export function planImport(sheet: Map<string, DispatchRecord>, existing: Record<string, unknown>[]) {
  const db = new Map(existing.map((r) => [String(r.serialNo), r]));
  const creates: DispatchRecord[] = [];
  const updates: { serialNo: string; data: Partial<Record<DispatchField, string>> }[] = [];
  const conflicts: Conflict[] = [];
  for (const rec of sheet.values()) {
    const row = db.get(rec.serialNo);
    if (!row) {
      creates.push(rec);
      continue;
    }
    const { fill, clash } = compare(row, rec);
    if (Object.keys(fill).length) updates.push({ serialNo: rec.serialNo, data: fill });
    for (const [field, kept, ignored] of clash) conflicts.push({ serialNo: rec.serialNo, field, kept, ignored, where: "database" });
  }
  return { creates, updates, conflicts };
}
