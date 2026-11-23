// The actuator master read live from Puja's Google Sheet (no import, no DB copy), parsed by the workbook parser.
import * as XLSX from "xlsx";
import { getOAuthClient } from "./googleAuth";
import { sheets as googleSheets } from "@googleapis/sheets";
import { IMPORTED_TAB, parseActuatorWorkbook, type Parsed } from "./actuatorMaster";

export { IMPORTED_TAB };
const SHEET_ID = "1kmC3Th8AGbfPG1qYedw7HBiiZsavbVY2pZM2nb10TuA";
// SUITABILITY is read too: the parser needs it. AUMA_RANGE / AUMA_ROTORK_ALT: speeds, Rotork torque drops, generic RM codes.
const TABS = ["ACT_MASTER", "GB_MASTER", "MAPPING", "VALVE_TORQUE", "GMD_GB_STOCK", "STOCK_ACT", "SUITABILITY", "AUMA_RANGE", "AUMA_ROTORK_ALT"];
const TTL_MS = 60_000; // a sheet edit shows within a minute

let cache: { at: number; master: Promise<Parsed> } | null = null;

/** The live master, cached in memory for a minute; concurrent callers share one read and a failed read is retried next call. */
export function loadActuatorMaster(): Promise<Parsed> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.master;
  const master = readSheet();
  cache = { at: Date.now(), master };
  master.catch(() => { if (cache?.master === master) cache = null; });
  return master;
}

type Rows = unknown[][];
/**
 * Every tab's rows by tab name. The imported (TFW) tab is optional: Google rejects the whole read when one named tab does not
 * exist ("Unable to parse range"), so that failure alone is tried once more without it (imported items then go "price pending", Indian pricing carries on).
 */
export async function readTabs(get: (ranges: string[]) => Promise<Rows[]>): Promise<Record<string, Rows>> {
  const read = async (tabs: string[]) => {
    const values = await get(tabs.map((t) => (/\W/.test(t) ? `'${t}'` : t))); // a name with spaces / brackets must be quoted
    return Object.fromEntries(tabs.map((t, i) => [t, values[i] ?? []]));
  };
  try { return await read([...TABS, IMPORTED_TAB]); }
  catch (e) {
    // Only "this tab does not exist" is retried; a quota, server or network error must come out (the failed read is then
    // retried next call), else imported items would be saved "no imported data" for a minute.
    if (!/Unable to parse range/i.test(e instanceof Error ? e.message : String(e))) throw e;
    console.warn(`[actuatorSheet] read with "${IMPORTED_TAB}" failed, retrying without it:`, e instanceof Error ? e.message : e);
    return { ...(await read(TABS)), [IMPORTED_TAB]: [] };
  }
}

async function readSheet(): Promise<Parsed> {
  // Same Google login as the other sheet syncs (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN).
  const api = googleSheets({ version: "v4", auth: getOAuthClient() });
  const tabs = await readTabs(async (ranges) => {
    const res = await api.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges, valueRenderOption: "UNFORMATTED_VALUE" });
    return ranges.map((_, i) => (res.data.valueRanges?.[i]?.values ?? []) as Rows);
  });
  const wb = XLSX.utils.book_new();
  for (const [tab, rows] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tab);
  return parseActuatorWorkbook(wb);
}
