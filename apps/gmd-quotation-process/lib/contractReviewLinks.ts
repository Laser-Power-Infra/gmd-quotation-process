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

/** Blank-cell fills from the first `category` mail tag, as { id, day } per line; lines in `skip` are left alone. */
export function mailTagFills(p: {
  ids: string[];
  rows: unknown[][];
  idx: number;
  mailDocsIdx: number;
  tag: MailDocCategory;
  skip?: ReadonlySet<string>;
}): { id: string; day: string }[] {
  return p.ids.flatMap((id, i) => {
    const day = p.skip?.has(id) ? null : mailTagDay(p.rows[i][p.idx], p.rows[i][p.mailDocsIdx], p.tag);
    return day ? [{ id, day }] : [];
  });
}

/** Runs `sync` for each contract in turn; one failing contract is logged and does not stop the others. */
export async function resyncEach(contracts: string[], sync: (contractNo: string) => Promise<unknown>) {
  let failed = 0;
  for (const c of contracts) {
    try {
      await sync(c);
    } catch (err) {
      failed++;
      console.error(`drawings approval-date re-sync failed for ${c}`, err);
    }
  }
  return { done: contracts.length - failed, failed };
}

/** Covered line ids, or null when the drawings lookup fails (tables missing, DB down): the caller then skips the APPROVAL DATE fill, never fills every blank line. */
export async function coveredOrNull(ids: string[], lookup: (ids: string[]) => Promise<Set<string>>): Promise<Set<string> | null> {
  try {
    return await lookup(ids);
  } catch (err) {
    console.error("drawings coverage lookup failed; APPROVAL DATE mail-tag fill skipped for this run", err);
    return null;
  }
}

/** resyncEach over the contracts `list` returns; a failing list counts as one failure and skips the re-sync. */
export async function resyncAll(list: () => Promise<string[]>, sync: (contractNo: string) => Promise<unknown>) {
  try {
    return await resyncEach(await list(), sync);
  } catch (err) {
    console.error("drawings contract list failed; approval-date re-sync skipped for this run", err);
    return { done: 0, failed: 1 };
  }
}
