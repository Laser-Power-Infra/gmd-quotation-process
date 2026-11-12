/**
 * Contract Review interlinking rules that need the app's own helpers (IST day, VRDATE parsing):
 * MC DATE / APPROVAL DATE from the mail tags, and PROD ENTRY DATE from the ERP's PROD ENTRY DUMP
 * tab. Pure, so they are tested without a database or a sheet.
 */
import { parseMailDocs, type MailDocCategory } from "@gmd/contract-review/columns";
import { parseGmdDate } from "./gmd_lib/dateParse";
import { normalizeKey, normalizeVrDate } from "./gmd_lib/execution-tracking-columns";
import { istDateOnly } from "./pbg/reminder-rules";

/**
 * The day of the first `category` mail tag (dd-MMM-yyyy, IST) for a blank MC DATE / APPROVAL DATE.
 * Null when the cell already holds a date, typed or filled earlier, or no such tag exists.
 */
export function mailTagDay(current: unknown, mailDocs: unknown, category: MailDocCategory): string | null {
  if (String(current ?? "").trim()) return null;
  const times = parseMailDocs(mailDocs)
    .filter((d) => d.c === category)
    .map((d) => Date.parse(d.at))
    .filter(Number.isFinite);
  return times.length ? normalizeVrDate(istDateOnly(new Date(Math.min(...times)))) : null;
}

/** Map key of one production line: "PROD ORDER||ITEM CODE", normalised like the other sheet joins. */
export const prodEntryKey = (prodOrder: unknown, itemCode: unknown) =>
  `${normalizeKey(prodOrder)}||${normalizeKey(itemCode)}`;

/**
 * PROD ENTRY DUMP rows -> the latest VRDATE (dd-MMM-yyyy) per production order + item. Rows with a
 * blank key or a blank or unreadable date are skipped, so they can never clear or move a stored
 * date, and counted, so a change in the ERP's date format shows up in the job's result.
 */
export function latestProdEntryDates(params: {
  rows: string[][];
  orderIdx: number;
  itemIdx: number;
  dateIdx: number;
}): { latest: Map<string, string>; skipped: number } {
  const { rows, orderIdx, itemIdx, dateIdx } = params;
  const latest = new Map<string, string>();
  let skipped = 0;
  for (const row of rows) {
    const day = normalizeVrDate(row[dateIdx]);
    const time = parseGmdDate(day)?.getTime();
    const order = normalizeKey(row[orderIdx]);
    const item = normalizeKey(row[itemIdx]);
    if (!day || time === undefined || !order || !item) {
      skipped++;
      continue;
    }
    const key = prodEntryKey(order, item);
    if (time > (parseGmdDate(latest.get(key))?.getTime() ?? -Infinity)) latest.set(key, day);
  }
  return { latest, skipped };
}
