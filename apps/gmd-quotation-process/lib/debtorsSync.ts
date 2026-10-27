/**
 * DEBTORS tab (execution-tracking workbook) -> `Debtor` table.
 *
 * Resolved by gid, never by title (see `readSheetTabByGid`). Column names are
 * matched exactly after normalisation, so a renamed column fails loudly instead
 * of binding to the wrong field.
 */

import { cell, requireColumns } from "./gmd_lib/bomMastErp";

export const DEBTORS_GID = 1451733703;

export const DEBTORS_HEADERS = {
  accSch: "ACC_SCH",
  accCode: "ACC_CODE",
  tCode: "TCODE",
  vrNo: "VRNO",
  drAmt: "DRAMT",
  vrDate: "VRDATE",
  dueDate: "DUEDATE",
  particular: "PARTICULAR",
  drAllocAmt: "DR_ALLOC_AMT",
  unAllocDr: "UN_ALLOC_DR",
  unAllocCr: "UN_ALLOC_CR",
  partyBillNo: "PARTYBILLNO",
  partyBillDate: "PARTYBILLDATE",
  accName: "ACC_NAME",
} as const;

export type DebtorRecord = {
  accSch: string | null;
  accCode: string;
  tCode: string | null;
  vrNo: string | null;
  drAmt: number | null;
  vrDate: Date | null;
  dueDate: Date | null;
  particular: string | null;
  drAllocAmt: number | null;
  unAllocDr: number | null;
  unAllocCr: number | null;
  partyBillNo: string | null;
  partyBillDate: Date | null;
  accName: string | null;
};

/** Blank -> null. Non-blank text that is not a number is an error, not zero. */
export function parseAmount(raw: string): number | null {
  const text = raw.replace(/,/g, "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`not a number: "${raw}"`);
  return n;
}

/** Sheet dates are DD-MM-YYYY. Stored as UTC midnight so the day never shifts. */
export function parseSheetDate(raw: string): Date | null {
  const text = raw.trim();
  if (text === "") return null;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  if (!m) throw new Error(`not a DD-MM-YYYY date: "${raw}"`);
  const [, dd, mm, yyyy] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCDate() !== Number(dd)) throw new Error(`invalid date: "${raw}"`);
  return date;
}

export type DebtorRowResult =
  | { ok: true; record: DebtorRecord }
  | { ok: false; error: string };

export function mapDebtorRow(
  row: string[],
  idx: Record<keyof typeof DEBTORS_HEADERS, number>,
): DebtorRowResult {
  const text = (key: keyof typeof DEBTORS_HEADERS) => cell(row, idx[key]) || null;
  const accCode = cell(row, idx.accCode);
  if (!accCode) return { ok: false, error: "blank ACC_CODE" };

  try {
    return {
      ok: true,
      record: {
        accSch: text("accSch"),
        accCode,
        tCode: text("tCode"),
        vrNo: text("vrNo"),
        drAmt: parseAmount(cell(row, idx.drAmt)),
        vrDate: parseSheetDate(cell(row, idx.vrDate)),
        dueDate: parseSheetDate(cell(row, idx.dueDate)),
        particular: text("particular"),
        drAllocAmt: parseAmount(cell(row, idx.drAllocAmt)),
        unAllocDr: parseAmount(cell(row, idx.unAllocDr)),
        unAllocCr: parseAmount(cell(row, idx.unAllocCr)),
        partyBillNo: text("partyBillNo"),
        partyBillDate: parseSheetDate(cell(row, idx.partyBillDate)),
        accName: text("accName"),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolves every DEBTORS_HEADERS column, failing if any is missing. */
export function resolveDebtorColumns(headers: string[], tabTitle: string) {
  const keys = Object.keys(DEBTORS_HEADERS) as (keyof typeof DEBTORS_HEADERS)[];
  const idx = requireColumns(headers, Object.values(DEBTORS_HEADERS), tabTitle);
  return Object.fromEntries(keys.map((k, i) => [k, idx[i]])) as Record<
    keyof typeof DEBTORS_HEADERS,
    number
  >;
}
