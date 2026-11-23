// Parses GMD_Actuator_Master.xlsx (or the live sheet, see actuatorSheet.ts) into rows for the actuator tables.
// Pure (no DB): the import script upserts the result; tests run it on a fixture.
// Columns are found by header text (prefix, case-insensitive), so added or moved columns are fine.
import * as XLSX from "xlsx";
import { isErpCode } from "./actuatorStock";

type Cell = string | number | boolean | Date | null | undefined;
type Spec = Record<string, [header: string, type: "s" | "n"]>;

const text = (v: Cell) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
// Non-numeric ("none", "-", "n/a") becomes null.
const num = (v: Cell) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};

/**
 * Rows of a sheet as arrays; the header row is the first at or after `from` whose first cell equals `firstHeader`.
 * The block ends where the next such header row starts (GB_MASTER stacks an AUMA block and Viral blocks).
 */
function table(wb: XLSX.WorkBook, sheet: string, firstHeader: string, from = 0) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet "${sheet}" not found in the workbook.`);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true });
  const isHeader = (r: Cell[], i: number) => i >= from && String(r[0] ?? "").trim().toUpperCase() === firstHeader;
  const at = rows.findIndex(isHeader);
  if (at < 0) throw new Error(`Sheet "${sheet}": header row starting "${firstHeader}" not found.`);
  const next = rows.findIndex((r, i) => i > at && isHeader(r, i));
  return { header: rows[at].map((h) => String(h ?? "").trim().toLowerCase()), body: rows.slice(at + 1, next < 0 ? undefined : next), rows, at };
}

// Read for display only, never used in a price or a pick: when the sheet renames or drops one it reads as blank
// instead of stopping every actuator price. 20 Nov 2026: MAPPING "GB FACTOR" became "AUMA GB FACTOR (ref)" and
// STOCK_ACT lost "DISPATCHED 26-27".
// 23 Nov 2026: STOCK_ACT lost "STATUS" ("WIRING DIAGRAM STATUS" is another column, read separately for auto-pick).
const REFERENCE_ONLY = new Set(["gbFactor", "dispatched2627", "status", "moving3m", "stockValue"]);

/** Maps each body row to {field: value} using the spec; rows rejected by `keep` are dropped. */
function extract(t: ReturnType<typeof table>, spec: Spec, keep: (r: Record<string, string | number | null>) => boolean) {
  const idx = Object.entries(spec).map(([field, [h, type]]) => {
    const i = t.header.findIndex((x) => x.startsWith(h.toLowerCase()));
    if (i < 0 && !REFERENCE_ONLY.has(field)) throw new Error(`Column "${h}" not found.`);
    return [field, i, type] as const;
  });
  return t.body
    .map((r) => Object.fromEntries(idx.map(([f, i, type]) => [f, type === "n" ? num(r[i]) : text(r[i])])))
    .filter(keep);
}

export interface Parsed {
  actuators: Record<string, string | number | null>[];
  gearboxes: Record<string, string | number | null>[];
  /**
   * GB_MASTER's Viral Industries gearboxes (GMD's regular gearbox supplier): the only gearboxes the auto-pick buys.
   * From Viral's 19-Nov worm + spur tables when present (they also carry ma, ratio, actFlange, rateNote), else the old block.
   */
  viralGearboxes: Record<string, string | number | null>[];
  valveTorques: Record<string, string | number | null>[];
  params: { name: string; value: number; note: string | null }[];
  mappings: Record<string, string | number | null>[];
  suitability: { mapKey: string; kind: "ACT" | "GB"; code: string; make: string; label: string; ratingNm: number | null; mark: string }[];
  gearboxStock: Record<string, string | number | null>[];
  actuatorStock: Record<string, string | number | null>[];
  /** STOCK_ACT lines whose WIRING DIAGRAM STATUS says "auto-pick ON"; every other stock actuator is set by hand only. */
  stockAutoPick: string[];
  /** AUMA_RANGE speed table: an AUMA SA model's max torque at each output speed, per phase. */
  aumaSpeeds: { model: string; phase: string; rpm: number; torque: number }[];
  /** AUMA_ROTORK_ALT notes: Rotork K torque below rated at the speeds they name ("108/102 at 144/192"). */
  rotorkDerates: { model: string; rpm: number; torque: number }[];
  /** AUMA_ROTORK_ALT: each AUMA / Rotork model's generic RM code; null = "NEW code" (to be created). */
  rmCodes: { make: "AUMA" | "Rotork"; model: string; code: string | null }[];
}

const ACT: Spec = {
  actCode: ["ACT CODE", "s"], make: ["MAKE", "s"], series: ["SERIES", "s"], model: ["MODEL", "s"], motion: ["MOTION", "s"],
  minTorque: ["MIN TORQUE", "n"], maxTorque: ["MAX TORQUE", "n"], valveFlange: ["VALVE FLANGE", "s"],
  speedRange: ["SPEED RANGE", "s"], dutyOptions: ["DUTY", "s"], dataStatus: ["DATA STATUS", "s"],
  price: ["PRICE", "n"], leadTimeWeeks: ["LEAD TIME", "n"], remarks: ["REMARKS", "s"],
};
const GB: Spec = {
  gbCode: ["GB CODE", "s"], make: ["MAKE", "s"], model: ["MODEL", "s"], maxOutputTorque: ["MAX OUTPUT TORQUE", "n"],
  torqueFactor: ["TORQUE FACTOR", "n"], topFlange: ["GB TOP", "s"], baseFlange: ["GB BASE", "s"],
  dataStatus: ["DATA STATUS", "s"], price: ["PRICE", "n"], remarks: ["REMARKS", "s"],
};
const VGB: Spec = {
  gbCode: ["GB CODE", "s"], make: ["MAKE", "s"], model: ["MODEL", "s"], maxOutputTorque: ["MAX OUTPUT TORQUE", "n"],
  erpCode: ["GMD ERP CODE", "s"], type: ["TYPE", "s"], baseFlange: ["GB BASE", "s"], price: ["PRICE", "n"], remarks: ["REMARKS", "s"],
};
// Viral's 19-Nov worm / spur tables: no TYPE column; RATE USED is the price. MA stays text like RATIO: a two-ratio spur box
// reads "8.8 / 7" and "10:1 / 8:1" (actuatorSelect.ts takes the pair). "MA (" keeps its "(" so it never matches MAKE / MAX ….
const VGB19: Spec = {
  gbCode: ["GB CODE", "s"], make: ["MAKE", "s"], model: ["MODEL", "s"], maxOutputTorque: ["MAX OUTPUT TORQUE", "n"],
  ma: ["MA (", "s"], ratio: ["RATIO", "s"], baseFlange: ["VALVE MOUNTING", "s"], actFlange: ["ACT MOUNTING", "s"],
  erpCode: ["GMD ERP CODE", "s"], price: ["RATE USED", "n"], rateNote: ["RATE NOTE", "s"],
};
const VT: Spec = {
  key: ["KEY", "s"], valveType: ["VALVE TYPE", "s"], dn: ["DN", "n"], motion: ["MOTION", "s"],
  indicativeTorque: ["INDICATIVE TORQUE", "n"], dataStatus: ["DATA STATUS", "s"], indicativeFlange: ["INDICATIVE TOP", "s"],
  flangeStd: ["FLANGE STD", "s"], gmdTorque: ["GMD DATA: TORQUE", "n"], gmdTopFlange: ["GMD DATA: TOP", "s"],
  effectiveFlange: ["EFFECTIVE TOP", "s"],
};
const MAP: Spec = {
  mapKey: ["MAP KEY", "s"], valveType: ["VALVE TYPE", "s"], dn: ["DN", "n"], pn: ["PN", "s"], valveTorque: ["VALVE TORQUE", "n"],
  requiredTorque: ["REQUIRED TORQUE", "n"], gearbox: ["GEARBOX (AUMA", "s"], gbFactor: ["GB FACTOR", "n"],
  actInputTorque: ["ACT INPUT", "n"], aumaModel: ["AUMA MODEL", "s"], aumaActCode: ["AUMA ACT CODE", "s"],
  rotorkModel: ["ROTORK MODEL", "s"], rotorkActCode: ["ROTORK ACT CODE", "s"], directPartTurn: ["DIRECT PART-TURN", "s"],
  stockRotorkNm: ["IN-STOCK ROTORK", "n"], stockRotorkQty: ["QTY AVAILABLE", "n"], valveFlange: ["VALVE TOP", "s"],
  gbBaseFlange: ["AUMA GB BASE", "s"], gbTopFlange: ["AUMA GB TOP", "s"], actFlange: ["AUMA ACT FLANGE", "s"],
  flangeCheck: ["FLANGE CHECK", "s"], gmdGbCode: ["GMD STOCK GEARBOX", "s"], gmdGbRating: ["GMD GB RATING", "n"],
  gmdGbAvailable: ["GMD GB AVAILABLE", "n"], note: ["NOTE", "s"],
};
const GBS: Spec = {
  erpCode: ["ERP ITEM CODE", "s"], gbType: ["GB TYPE", "s"], ratedTorque: ["RATED TORQUE", "n"], received: ["RECEIVED", "n"],
  dispatched: ["DISPATCHED", "n"], available: ["AVAILABLE", "n"], stockPerErp: ["STOCK AS PER ERP", "n"],
  erpGap: ["ERP − AVAIL", "n"], rate: ["RATE/UNIT", "n"], stockValue: ["STOCK VALUE", "n"], baseFlange: ["BASE FLANGE", "s"],
  topFlange: ["TOP FLANGE", "s"], suitsBfvPn10: ["SUITS BFV PN10", "n"], suitsBfvPn16: ["SUITS BFV PN16", "n"], remarks: ["REMARKS", "s"],
};
const STK: Spec = {
  erpCode: ["ERP CODE", "s"], l6Code: ["L6 CODE", "s"], ratingCode: ["RATING CODE", "s"], series: ["SERIES", "s"],
  torque: ["TORQUE", "n"], outputRpm: ["OUTPUT RPM", "n"], make: ["MAKE", "s"], received: ["RECEIVED", "n"],
  dispatched: ["DISPATCHED", "n"], available: ["AVAILABLE", "n"], physicalSum: ["SUM OF PHYSICAL", "n"],
  stockPerErp: ["STOCK AS PER ERP", "n"], erpGap: ["ERP − PHYSICAL", "n"], rate: ["RATE/UNIT", "n"],
  stockValue: ["STOCK VALUE", "n"], moving3m: ["MOVING", "s"], dispatched2627: ["DISPATCHED 26", "n"], status: ["STATUS", "s"],
};
const AUMA_SPEED: Spec = { model: ["MODEL", "s"], phase: ["PHASE", "s"], rpm: ["OUTPUT SPEED", "n"], torque: ["MAX TORQUE", "n"] };
const ALT: Spec = {
  aumaModel: ["AUMA MODEL", "s"], aumaRm: ["AUMA RM CODE", "s"], rotork: ["ROTORK ALTERNATE", "s"], rotorkSpeeds: ["ROTORK SPEEDS", "s"],
  rotorkRm: ["ROTORK RM CODE", "s"],
};
const kModels = (s: unknown) => [...String(s ?? "").matchAll(/\bK\s*(\d+)/gi)].map((x) => `K${x[1]}`); // "K 500 / K 600" -> K500, K600

/** A Rotork speed note of AUMA_ROTORK_ALT, e.g. "4.5–192 (115 at 12; 108/102 at 144/192)": torque per named speed. */
function rotorkDerates(models: string[], note: string): Parsed["rotorkDerates"] {
  const lead = /^\s*K\s*(\d+)\b/i.exec(note); // "K600 4.5–192 (…)" says which model of "K 500 / K 600" the note is about
  const hits = [...note.matchAll(/([\d.]+(?:\s*\/\s*[\d.]+)*)\s*(?:Nm\s*)?at\s*([\d.]+(?:\s*\/\s*[\d.]+)*)/gi)];
  const pairs = hits.map(([, t, s]) => [t.split("/").map(Number), s.split("/").map(Number)]);
  // A note the pattern cannot read fully would leave a model at its rated torque at a speed where it has less.
  if (hits.length !== (note.match(/\bat\b/gi) ?? []).length || pairs.some(([t, s]) => t.length !== 1 && t.length !== s.length))
    throw new Error(`AUMA_ROTORK_ALT: cannot read the Rotork speed note "${note}".`);
  return (lead ? [`K${lead[1]}`] : models).flatMap((model) =>
    pairs.flatMap(([t, s]) => s.map((rpm, i) => ({ model, rpm, torque: t[t.length === 1 ? 0 : i] }))));
}

/** SUITABILITY column label -> actuator/gearbox code. "Rotork K30" -> ACT-RT-K30, "GMD GB RED070005" -> RED070005. */
function suitabilityColumn(label: string, actByModel: Map<string, string>) {
  const gb = label.match(/^GMD GB (.+)$/);
  if (gb) return { kind: "GB" as const, make: "GMD", code: gb[1].trim() };
  const m = label.match(/^(AUMA|Rotork) (.+)$/);
  const code = m && actByModel.get(`${m[1]}|${m[2].trim()}`);
  if (!m || !code) throw new Error(`SUITABILITY column "${label}" has no matching ACT_MASTER model.`);
  return { kind: "ACT" as const, make: m[1], code };
}

export const SPECS = { ACT, GB, VGB, VT, MAP, GBS, STK }

export function parseActuatorWorkbook(wb: XLSX.WorkBook): Parsed {
  const actuators = extract(table(wb, "ACT_MASTER", "ACT CODE"), ACT, (r) => !!r.actCode && !!r.make);
  const gb = table(wb, "GB_MASTER", "GB CODE");
  const gearboxes = extract(gb, GB, (r) => !!r.gbCode && !!r.make);
  // Viral's 19-Nov tables (GB CODE headers with a RATE USED column) replace the old Viral block when present.
  const viral19 = gb.rows.flatMap((r, i) =>
    text(r[0])?.toUpperCase() === "GB CODE" && r.some((c) => /^RATE USED/i.test(text(c) ?? "")) ? [table(wb, "GB_MASTER", "GB CODE", i)] : []);
  // Old Viral block: found by its header row (the one with a GMD ERP CODE column), so rows can be inserted above it.
  const viralAt = gb.rows.findIndex((r) => r.some((c) => text(c)?.toUpperCase() === "GMD ERP CODE"));
  const viral: Parsed["viralGearboxes"] = viral19.length
    ? viral19.flatMap((t) => {
      // No TYPE column: walk up over blank and one-cell rows (title, notes) to the first that names worm or spur.
      const up = t.rows.slice(0, t.at).reverse();
      const end = up.findIndex((r) => r.filter((c) => text(c)).length > 1); // a data or header row ends the title area
      const title = up.slice(0, end < 0 ? undefined : end).map((r) => r.map(text).filter(Boolean).join(" ")).find((s) => /worm|spur/i.test(s)) ?? "";
      const worm = /worm/i.test(title);
      if (worm === /spur/i.test(title)) throw new Error(`GB_MASTER row ${t.at + 1}: the title above this Viral table must name worm or spur (one of them).`);
      const type = worm ? "Worm (part-turn)" : "Spur (multi-turn)";
      // The spur header leaves ACT MOUNTING FLANGE / GMD ERP CODE blank: a blank header cell takes the name another 19-Nov
      // table gives that column (the tables share their columns), in either order on the sheet.
      const header = t.header.map((h, i) => h || viral19.map((x) => x.header[i]).find(Boolean) || "");
      return extract({ ...t, header }, VGB19, (r) => !!r.gbCode && !!r.make).map((r) => ({ ...r, type }));
    })
    : viralAt < 0 ? [] : extract(table(wb, "GB_MASTER", "GB CODE", viralAt), VGB, (r) => !!r.gbCode && !!r.make);
  const viralGearboxes = viral.map((r) => ({ ...r, erpCode: isErpCode(r.erpCode as string | null) ? r.erpCode : null })); // "—", "RSU010004?" = no code

  const vt = table(wb, "VALVE_TORQUE", "KEY");
  const valveTorques = extract(vt, VT, (r) => !!r.key?.toString().includes("|"));
  const params = vt.rows
    .slice(0, vt.at)
    .filter((r) => text(r[0]) && num(r[1]) !== null)
    .map((r) => ({ name: text(r[0])!, value: num(r[1])!, note: text(r[2]) }));

  const mappings = extract(table(wb, "MAPPING", "MAP KEY"), MAP, (r) => !!r.mapKey?.toString().includes("|"));
  const gearboxStock = extract(table(wb, "GMD_GB_STOCK", "ERP ITEM CODE"), GBS, (r) => !!r.erpCode && !!r.gbType);

  const actByModel = new Map(actuators.map((a) => [`${a.make}|${a.model}`, a.actCode as string]));
  const stk = table(wb, "STOCK_ACT", "ERP CODE");
  const actuatorStock = extract(stk, STK, (r) => !!r.erpCode && !!r.series).map((r) => {
    // K-series rating code "K300/RPM24" -> ACT-RT-K300 (only when that model exists in ACT_MASTER).
    const k = String(r.ratingCode ?? "").match(/^(K\d+)/);
    return { ...r, actCode: (k && actByModel.get(`Rotork|${k[1]}`)) || null };
  });
  // Old wiring diagrams are not interchangeable (Puja, 20 Nov): a stock line is auto-picked only when marked "auto-pick ON".
  // Kept out of the actuatorStock rows, which the import script stores column for column.
  const stockAutoPick = stk.header.some((h) => h.startsWith("wiring diagram"))
    ? extract(stk, { erpCode: ["ERP CODE", "s"], wd: ["WIRING DIAGRAM", "s"] }, (r) => /auto-pick\s*on\b/i.test(String(r.wd ?? ""))).map((r) => String(r.erpCode))
    : [];

  // AUMA_RANGE stacks a price table and the speed table; both headers start MODEL, only the speed table has PHASE.
  const range = table(wb, "AUMA_RANGE", "MODEL");
  const speedAt = range.rows.findIndex((r) => text(r[0])?.toUpperCase() === "MODEL" && r.some((c) => text(c)?.toUpperCase() === "PHASE"));
  if (speedAt < 0) throw new Error('Sheet "AUMA_RANGE": speed table (MODEL / PHASE header) not found.');
  const aumaSpeeds = extract(table(wb, "AUMA_RANGE", "MODEL", speedAt), AUMA_SPEED, (r) => !!r.model && !!r.phase && r.rpm != null && r.torque != null) as Parsed["aumaSpeeds"];

  const alt = extract(table(wb, "AUMA_ROTORK_ALT", "AUMA MODEL"), ALT, (r) => /^SA\s*\d/i.test(String(r.aumaModel ?? "")));
  const rmCode = (c: unknown) => (isErpCode(c as string | null) ? String(c).trim().toUpperCase() : null); // "NEW code" = none yet
  const rmCodes: Parsed["rmCodes"] = alt.flatMap((r) => [
    { make: "AUMA" as const, model: String(r.aumaModel), code: rmCode(r.aumaRm) },
    ...kModels(r.rotork).map((model) => ({ make: "Rotork" as const, model, code: rmCode(r.rotorkRm) })),
  ]);
  const derates = alt.flatMap((r) => rotorkDerates(kModels(r.rotork), String(r.rotorkSpeeds ?? "")));

  // SUITABILITY: header row, then a "Rating (Nm)" row, then one row per MAP KEY; marks start at column 7.
  const s = table(wb, "SUITABILITY", "MAP KEY");
  const ratingRow = s.body.find((r) => String(r[0] ?? "").startsWith("Rating")) ?? [];
  const firstMark = s.header.findIndex((h) => /^(rotork|auma|gmd gb) /.test(h));
  const cols = s.header
    .map((_, i) => i)
    .filter((i) => i >= firstMark && s.header[i])
    .map((i) => ({ i, label: String(s.rows[s.at][i]).trim(), ...suitabilityColumn(String(s.rows[s.at][i]).trim(), actByModel) }));
  const suitability: Parsed["suitability"] = [];
  for (const r of s.body) {
    const mapKey = text(r[0]);
    if (!mapKey?.includes("|")) continue;
    for (const c of cols) {
      suitability.push({ mapKey, kind: c.kind, code: c.code, make: c.make, label: c.label, ratingNm: num(ratingRow[c.i]), mark: text(r[c.i]) ?? "" });
    }
  }
  return {
    actuators, gearboxes, viralGearboxes, valveTorques, params, mappings, suitability, gearboxStock, actuatorStock, stockAutoPick,
    aumaSpeeds, rotorkDerates: derates, rmCodes,
  };
}

export const readActuatorWorkbook = (path: string) => parseActuatorWorkbook(XLSX.readFile(path));

/** Workbook cells that only overwrite the DB when filled: a blank keeps what is already stored (prices, lead time, offers). */
export const KEEP_IF_BLANK = ["price", "leadTimeWeeks", "offerDate", "offerValidTill"];

/** Update object for an upsert: the row without blank KEEP_IF_BLANK cells. */
export const updateData = <T extends Record<string, unknown>>(row: T): Partial<T> =>
  Object.fromEntries(Object.entries(row).filter(([k, v]) => !(KEEP_IF_BLANK.includes(k) && v === null))) as Partial<T>;
