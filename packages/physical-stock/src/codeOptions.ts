// Pure narrowing of the New Item ERP-code picker (no DB, no React).
// Rows come from the db-stock snapshot tables RmCodeOption / BomCodeOption.

export interface RmCodeOptionRow {
  erpItemCode: string;
  itemName: string | null;
  l8Category: string | null;
}

export interface BomCodeOptionRow {
  bomId: string;
  valveType: string | null;
  size: string | null;
  pn: string | null;
  bomType: string;
  erpItemCode: string;
}

export interface CodeOptions {
  rm: RmCodeOptionRow[];
  bom: BomCodeOptionRow[];
}

// shortcut: plain trim + uppercase + collapsed spaces; quotation FullItem.size/pnGmd and
// stock Dia/PN spellings that differ beyond that (e.g. 50 vs 50MM) will not match. Upgrade
// to a shared normalizer if the first sync shows misses.
const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export const isFinishedValve = (l8: string | null | undefined) => norm(l8) === "FINISHED VALVES";

/** Raw Material codes in the picked L8 item category (all codes when none is picked), distinct and sorted. */
export function rmCodesFor(rm: RmCodeOptionRow[], l8: string | null | undefined): string[] {
  const want = norm(l8);
  const codes = rm.filter((r) => !want || norm(r.l8Category) === want).map((r) => r.erpItemCode);
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
}

export interface ValveChoice {
  valveType?: string;
  size?: string;
  pn?: string;
}

/** CREATE BOM rows matching every picked valve type / size / PN (unpicked ones do not constrain). */
export function matchBoms(bom: BomCodeOptionRow[], pick: ValveChoice): BomCodeOptionRow[] {
  const want = { valveType: norm(pick.valveType), size: norm(pick.size), pn: norm(pick.pn) };
  return bom.filter(
    (r) =>
      (!want.valveType || norm(r.valveType) === want.valveType) &&
      (!want.size || norm(r.size) === want.size) &&
      (!want.pn || norm(r.pn) === want.pn),
  );
}

/** Distinct BOM ids among matched rows, sorted: the "BOM" select shows these when more than one. */
export const bomIdsOf = (rows: BomCodeOptionRow[]): string[] =>
  [...new Set(rows.map((r) => r.bomId))].sort((a, b) => a.localeCompare(b));

/** Distinct RM codes of the matched rows, narrowed to one BOM when `bomId` is set. */
export function codesOf(rows: BomCodeOptionRow[], bomId?: string): string[] {
  const codes = rows.filter((r) => !bomId || r.bomId === bomId).map((r) => r.erpItemCode);
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b));
}
