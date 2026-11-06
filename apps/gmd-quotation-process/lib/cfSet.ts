import { computeFlangeWeightKg, decodeBoltWeight, parseNumber, resolveMocDensity } from "./technical/formulas";

/**
 * "CF set" = 2 companion flanges + 2 gaskets + bolts + nuts for a valve, priced at
 * quote time from the Technical Flange master and per-kg rates (CF_* lookup types).
 * Pure: the DB reads/writes live in lib/cfSetItem.ts.
 */

/** First number in free text: "DN 50", "50MM", "PN-10/16" -> "50"/"50"/"10". */
// shortcut: a "PN-10/16" rating matches on 10 only; split-rating rows need a real parser if they ever differ in cost.
export function firstNumberKey(value: string | null | undefined): string | null {
  return /[0-9]+(?:\.[0-9]+)?/.exec(String(value ?? ""))?.[0] ?? null;
}

const MOC_ALIASES: Record<string, string> = {
  "CAST IRON": "CI",
  "DUCTILE IRON": "DI",
  "CARBON STEEL": "CS",
  "CAST STEEL": "CS",
  "STAINLESS STEEL": "SS",
  "MILD STEEL": "MS",
  "GALVANIZED IRON": "GI",
  GALVANIZED: "GI",
  GALVANISED: "GI",
};

/** "C.I." / "Cast Iron" / "CI" all collapse to "CI". */
export function mocKey(value: string | null | undefined): string {
  const n = String(value ?? "").trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
  return MOC_ALIASES[n] ?? n;
}

/** Items store combined MOCs ("DUCTILE IRON/CAST IRON"): each half is acceptable. */
export function mocKeys(value: string | null | undefined): Set<string> {
  return new Set(String(value ?? "").split("/").map((p) => mocKey(p)).filter(Boolean));
}

const STANDALONE_TYPES = new Set(["COMPANION FLANGE", "GASKET", "BOLTS OR NUTS"]);
// Only an explicit request counts: "with flanged ends", "bonnet gasket" or "bolts & nuts" describe the valve's own build.
const CF_TEXT = /with\s+(?:companion\s+)?flanges?\b|\bC\.?F\b|with\s+(?:fasteners?|gaskets?|bolts?\s*(?:&|and)\s*nuts?)\b/i;

/** Party text asking for flanges/fasteners/gaskets on a valve -> the "flange" (full set) Others tick. */
export function detectCfSet(itemName: string | null | undefined, itemType: string | null | undefined): string[] {
  const type = String(itemType ?? "").toUpperCase();
  if (!/VALVE/.test(type) || STANDALONE_TYPES.has(type)) return [];
  return CF_TEXT.test(String(itemName ?? "")) ? ["flange"] : [];
}

export type CfFlangeRow = {
  rowIndex: number;
  size: string | null;
  moc: string | null;
  pnRatingClass: string | null;
  standards: string | null;
  idMm: string | null;
  odMm: string | null;
  pcdMm: string | null;
  noOfHoleNos: string | null;
  holeDia: string | null;
  thicknessOfFlange: string | null;
  totalWeightKg: string | null;
  boltWeight: string | null;
  nutWeight: string | null;
};

export type CfRates = {
  flange: Record<string, number>;
  fastener: Record<string, number>;
  gasket: Record<string, number>;
  machining: Record<string, number>;
};

export type CfItem = {
  size: string | null;
  pnRating: string | null;
  moc: string | null;
  itemType: string | null;
  itemName: string;
  others: string[];
};

export type CfLine = {
  part: string;
  qty: number;
  unitKg: number;
  rateKey: string;
  rate: number;
  machining?: number;
  unitCost: number;
  cost: number;
};

export type CfResult = {
  lines: CfLine[];
  total: number;
  missing: string[];
  flangeMoc: string;
  flangeRowIndex: number | null;
  standardAssumed: boolean;
};

const GASKET_T_MM = 3;
// shortcut: CAF uses the rubber density (1.5); give CAF its own density if the rate is per-kg of a heavier sheet.
const GASKET_DENSITY = 1.5;

const r2 = (n: number) => Number(n.toFixed(2));

/** Ring gasket kg: OD = PCD - hole dia, ID = flange ID, 3 mm, 1.5 g/cc. Null when a dimension is missing. */
export function gasketWeightKg(row: Pick<CfFlangeRow, "idMm" | "pcdMm" | "holeDia">): number | null {
  const id = parseNumber(row.idMm);
  const pcd = parseNumber(row.pcdMm);
  const hole = parseNumber(row.holeDia);
  if (id == null || pcd == null || hole == null) return null;
  const od = pcd - hole;
  const kg = ((Math.PI / 4) * (od * od - id * id) * GASKET_T_MM * GASKET_DENSITY) / 1e6;
  return kg > 0 ? kg : null;
}

/** Flange-tab gasket columns: weight (3 dp) and cost at the RUBBER rate; blank when not computable. */
export function gasketFields(row: Pick<CfFlangeRow, "idMm" | "pcdMm" | "holeDia">, rubberRate: number | null) {
  const kg = gasketWeightKg(row);
  return {
    gasketWeightKg: kg != null ? kg.toFixed(3) : "",
    gasketCost: kg != null && rubberRate ? (kg * rubberRate).toFixed(2) : "",
  };
}

function machiningBand(size: string | null): string | null {
  const n = parseNumber(firstNumberKey(size));
  if (n == null) return null;
  return n <= 100 ? "<=100" : n <= 300 ? "150-300" : n <= 600 ? "350-600" : ">600";
}

export function computeCfSet(
  item: CfItem,
  flangeRows: CfFlangeRow[],
  rates: CfRates,
  densities: ReadonlyMap<string, number>,
  opts?: { flangeMoc?: string },
): CfResult {
  const wants = item.others.map((o) => String(o).toUpperCase());
  const full = wants.some((o) => o.includes("FLANGE")); // one "flange" tick = the full set
  const wantGasket = full || wants.some((o) => o.includes("GASKET"));
  const wantFasteners = full || wants.some((o) => o.includes("BOLT") || o.includes("NUT"));
  // Flange MOC: MS (she wrote "MS/CS"), SS for SS valves; the child item's MOC can override.
  const flangeMoc = opts?.flangeMoc ? mocKey(opts.flangeMoc) : mocKeys(item.moc).has("SS") ? "SS" : "MS";
  const out: CfResult = { lines: [], total: 0, missing: [], flangeMoc, flangeRowIndex: null, standardAssumed: false };
  if (!full && !wantGasket && !wantFasteners) return out;

  const sizeKey = firstNumberKey(item.size);
  const pnKey = firstNumberKey(item.pnRating);
  const isClass = /class|#|lb/i.test(item.pnRating ?? "");
  const std = isClass ? "16.5" : "1538";
  const label = `DN${sizeKey ?? "?"} ${item.pnRating ?? "no PN"} ${flangeMoc}`;
  if (sizeKey === null || pnKey === null) {
    out.missing.push(`Size or PN rating missing on the valve (${label})`);
    return out;
  }

  const candidates = flangeRows
    .filter((r) => firstNumberKey(r.size) === sizeKey && firstNumberKey(r.pnRatingClass) === pnKey && mocKeys(r.moc).has(flangeMoc))
    .sort((a, b) => a.rowIndex - b.rowIndex);
  const hasStd = candidates.some((r) => (r.standards ?? "").trim() !== "");
  const matched = hasStd ? candidates.filter((r) => (r.standards ?? "").toLowerCase().includes(std)) : candidates;
  // shortcut: several rows for the same size/PN/MOC/standard (e.g. FF vs RF) -> lowest rowIndex; add flangeType matching if they differ in weight.
  const row = matched[0];
  if (!row) {
    out.missing.push(`No flange master row for ${label}${hasStd ? ` with standard ${isClass ? "ASME B16.5" : "IS 1538"}` : ""}`);
    return out;
  }
  out.flangeRowIndex = row.rowIndex;
  out.standardAssumed = !hasStd;

  const holes = parseNumber(row.noOfHoleNos);
  const itemText = item.itemName ?? "";
  const rate = (table: Record<string, number>, name: string, key: string): number | null => {
    const v = table[key];
    if (v !== undefined && v > 0) return v;
    out.missing.push(`${name} ${key}`);
    return null;
  };
  const add = (part: string, qty: number, unitKg: number, rateKey: string, rateVal: number, machining = 0) => {
    const unitCost = unitKg * rateVal + machining;
    out.lines.push({
      part, qty, unitKg: Number(unitKg.toFixed(4)), rateKey, rate: rateVal,
      ...(machining ? { machining } : {}), unitCost: r2(unitCost), cost: r2(qty * unitCost),
    });
  };

  if (full) {
    const stored = parseNumber(row.totalWeightKg);
    const kg =
      stored && stored > 0
        ? stored
        : computeFlangeWeightKg(
            { odMm: row.odMm, idMm: row.idMm, noOfHoleNos: row.noOfHoleNos, holeDia: row.holeDia, thicknessOfFlange: row.thicknessOfFlange },
            resolveMocDensity(flangeMoc, densities),
          )?.weightKg ?? null;
    const r = rate(rates.flange, "CF_FLANGE_RATE", flangeMoc);
    if (kg == null) out.missing.push(`Flange weight (master blank, no density/dimensions) for ${label}`);
    else if (r != null) {
      const band = machiningBand(item.size);
      add("CF", 2, kg, flangeMoc, r, (band && rates.machining[band]) || 0);
    }
  }

  if (wantFasteners) {
    const boltKg = decodeBoltWeight(row.boltWeight).weightKg;
    const nutKg = parseNumber(row.nutWeight);
    const key = /\bSS\b|stainless/i.test(itemText) ? "SS" : /\bAS\b/.test(itemText) || /B7/i.test(itemText) ? "AS" : "GI";
    const r = rate(rates.fastener, "CF_FASTENER_RATE", key);
    if (holes == null || boltKg == null || nutKg == null) out.missing.push(`Bolt/nut weight or hole count blank in master for ${label}`);
    else if (r != null) {
      // shortcut: wafer has no face-to-face length in the master, so a stud = 2 x the master bolt weight.
      const wafer = /wafer/i.test(itemText) && /BUTTERFLY/i.test(item.itemType ?? "");
      add("Bolts", wafer ? holes : holes * 2, wafer ? boltKg * 2 : boltKg, key, r);
      add("Nuts", holes * 2, nutKg, key, r);
    }
  }

  if (wantGasket) {
    const kg = gasketWeightKg(row);
    const key = /\bCAF\b/i.test(itemText) ? "CAF" : "RUBBER";
    const r = rate(rates.gasket, "CF_GASKET_RATE", key);
    if (kg == null) out.missing.push(`Gasket dimensions (ID/PCD/hole dia) blank in master for ${label}`);
    else if (r != null) add("Gaskets", 2, kg, key, r);
  }

  out.total = r2(out.lines.reduce((s, l) => s + l.cost, 0));
  return out;
}
