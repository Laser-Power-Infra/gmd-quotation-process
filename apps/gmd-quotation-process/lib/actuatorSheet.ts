// The actuator master read live from Puja's Google Sheet (no import, no DB copy), parsed by the workbook parser.
import * as XLSX from "xlsx";
import { getOAuthClient } from "./googleAuth";
import { sheets as googleSheets } from "@googleapis/sheets";
import { parseActuatorWorkbook, type Parsed } from "./actuatorMaster";

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

async function readSheet(): Promise<Parsed> {
  // Same Google login as the other sheet syncs (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN).
  const auth = getOAuthClient();
  const res = await googleSheets({ version: "v4", auth }).spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: TABS, valueRenderOption: "UNFORMATTED_VALUE" });
  const wb = XLSX.utils.book_new();
  TABS.forEach((tab, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res.data.valueRanges?.[i]?.values ?? []), tab));
  return parseActuatorWorkbook(wb);
}
