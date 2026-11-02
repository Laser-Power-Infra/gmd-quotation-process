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

/** FG item (GMD Item Creation Form) that has a BOM ID; snapshot of the quotation DB's FullItem + Bom. */
export interface FgBomOptionRow {
  fgCode: string;
  bomId: string;
  itemType: string | null;
  moc: string | null;
  size: string | null;
}

export const NO_BOM_FG = "NO BOM FG FOUND";
export const PRODUCTION_ITEM = "PRODUCTION ITEM";

// "SLUICE VALVE-RESILIENT-NON-RISING" -> "SLUICE VALVE".
const typeHead = (v: string | null | undefined) => norm(v).split("-")[0].trim();

const MOC_GROUPS = [
  { name: "DUCTILE IRON/CAST IRON", members: ["DUCTILE IRON", "CAST IRON"] },
  { name: "CAST STEEL/CARBON STEEL", members: ["CAST STEEL", "CARBON STEEL"] },
];
/** Either spelling of a group (single or compound, any order) collapses to its group name. */
const mocGroup = (v: string | null | undefined) => {
  const parts = norm(v).split("/").map((p) => p.trim());
  return MOC_GROUPS.find((g) => parts.every((p) => g.members.includes(p)))?.name ?? norm(v);
};

const fgKey = (type: string | null | undefined, moc: string | null | undefined, size: string | null | undefined) =>
  [typeHead(type), mocGroup(moc), normSize(size)].join("|");

export interface FgMatch {
  fg_item_code: string | null;
  production_item: string | null;
}

/**
 * Finished-valve stock row -> its FG item code, matching type + MOC + size only (first FG wins).
 * Finished valves without a BOM FG say NO BOM FG FOUND; the ones with one are PRODUCTION ITEMs.
 * Other categories stay blank. An empty FG list (not synced yet) leaves everything blank.
 */
export function fgMatcher(fg: FgBomOptionRow[]) {
  const byKey = new Map<string, string>();
  for (const r of fg) {
    const k = fgKey(r.itemType, r.moc, r.size);
    if (!byKey.has(k)) byKey.set(k, r.fgCode);
  }
  return (r: {
    l8_item_category: string | null;
    l2_valve_type: string | null;
    l5_material: string | null;
    dimension: string | null;
  }): FgMatch => {
    if (!byKey.size || !isFinishedValve(r.l8_item_category)) return { fg_item_code: null, production_item: null };
    const code = byKey.get(fgKey(r.l2_valve_type, r.l5_material, r.dimension));
    return code ? { fg_item_code: code, production_item: PRODUCTION_ITEM } : { fg_item_code: NO_BOM_FG, production_item: null };
  };
}
