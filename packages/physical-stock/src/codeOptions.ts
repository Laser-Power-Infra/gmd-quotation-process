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

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// The two databases spell the same fact differently (checked against live data, 2 Nov 2026):
// size is "700" in FullItem but "700MM" in stock; PN is "CLASS-150#" / compound "PN-10/16"
// in FullItem but "CLASS 150#" / "PN-16" in stock; valve type is "SLUICE VALVE-METAL-RISING"
// in FullItem but "SLUICE VALVE" in stock. Each comparator below absorbs exactly those gaps.

/** "700MM" and "700" compare equal; "450X300MM" keeps its shape minus the unit. */
const normSize = (v: string | null | undefined) => norm(v).replace(/MM$/, "");

/** One PN cell ("PN-16", "CLASS 150#") as a dashless, spaceless token. */
const pnToken = (v: string) => v.replace(/[-\s]/g, "");

/** A FullItem PN can be compound ("PN-20/25/30", "CLASS-300#/PN-40"): expand to every token it covers. */
const pnTokens = (v: string | null | undefined): string[] => {
  const s = norm(v);
  if (!s || s === "NA") return [];
  const parts = s.split("/");
  const out: string[] = [];
  let prefix = "";
  for (const raw of parts) {
    const p = raw.trim();
    // "PN-20/25/30": later parts are bare numbers that inherit the "PN-" prefix.
    const m = /^([A-Z]+)[-\s]*(.*)$/.exec(p);
    if (m && m[2] !== "") prefix = m[1];
    out.push(pnToken(/^[\d.]/.test(p) ? `${prefix}${p}` : p));
  }
  return out;
};

const pnMatches = (bomPn: string | null | undefined, pickedPn: string | null | undefined) => {
  const want = pnToken(norm(pickedPn));
  return pnTokens(bomPn).includes(want);
};

/** Stock's "SLUICE VALVE" matches FullItem's "SLUICE VALVE-METAL-RISING" (prefix on word boundary). */
const typeMatches = (bomType: string | null | undefined, pickedType: string | null | undefined) => {
  const have = norm(bomType);
  const want = norm(pickedType);
  return have === want || have.startsWith(`${want}-`) || have.startsWith(`${want} `);
};

export const isFinishedValve = (l8: string | null | undefined) => norm(l8) === "FINISHED VALVES";

export interface ValveChoice {
  valveType?: string;
  size?: string;
  pn?: string;
}

/** CREATE BOM rows matching every picked valve type / size / PN (unpicked ones do not constrain). */
export function matchBoms(bom: BomCodeOptionRow[], pick: ValveChoice): BomCodeOptionRow[] {
  return bom.filter(
    (r) =>
      (!norm(pick.valveType) || typeMatches(r.valveType, pick.valveType)) &&
      (!norm(pick.size) || normSize(r.size) === normSize(pick.size)) &&
      (!norm(pick.pn) || pnMatches(r.pn, pick.pn)),
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
