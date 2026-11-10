// Parses GMD_Actuator_Master.xlsx into rows for the actuator tables.
// Pure (no DB): the import script upserts the result; tests run it on a fixture.
// Columns are found by header text (prefix, case-insensitive), so added or moved columns are fine.
import * as XLSX from "xlsx";

type Cell = string | number | boolean | Date | null | undefined;
type Spec = Record<string, [header: string, type: "s" | "n"]>;

const text = (v: Cell) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
// Non-numeric ("none", "-", "n/a") becomes null.
const num = (v: Cell) => {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};

/** Rows of a sheet as arrays; the header row is the first whose first cell equals `firstHeader`. */
function table(wb: XLSX.WorkBook, sheet: string, firstHeader: string) {
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet "${sheet}" not found in the workbook.`);
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true });
  const at = rows.findIndex((r) => String(r[0] ?? "").trim().toUpperCase() === firstHeader);
  if (at < 0) throw new Error(`Sheet "${sheet}": header row starting "${firstHeader}" not found.`);
  return { header: rows[at].map((h) => String(h ?? "").trim().toLowerCase()), body: rows.slice(at + 1), rows, at };
}

/** Maps each body row to {field: value} using the spec; rows rejected by `keep` are dropped. */
function extract(t: ReturnType<typeof table>, spec: Spec, keep: (r: Record<string, string | number | null>) => boolean) {
  const idx = Object.entries(spec).map(([field, [h, type]]) => {
    const i = t.header.findIndex((x) => x.startsWith(h.toLowerCase()));
    if (i < 0) throw new Error(`Column "${h}" not found.`);
    return [field, i, type] as const;
  });
  return t.body
    .map((r) => Object.fromEntries(idx.map(([f, i, type]) => [f, type === "n" ? num(r[i]) : text(r[i])])))
    .filter(keep);
}

export interface Parsed {
  actuators: Record<string, string | number | null>[];
  gearboxes: Record<string, string | number | null>[];
  valveTorques: Record<string, string | number | null>[];
  params: { name: string; value: number; note: string | null }[];
  mappings: Record<string, string | number | null>[];
  suitability: { mapKey: string; kind: "ACT" | "GB"; code: string; make: string; label: string; ratingNm: number | null; mark: string }[];
  gearboxStock: Record<string, string | number | null>[];
  actuatorStock: Record<string, string | number | null>[];
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

/** SUITABILITY column label -> actuator/gearbox code. "Rotork K30" -> ACT-RT-K30, "GMD GB RED070005" -> RED070005. */
function suitabilityColumn(label: string, actByModel: Map<string, string>) {
  const gb = label.match(/^GMD GB (.+)$/);
  if (gb) return { kind: "GB" as const, make: "GMD", code: gb[1].trim() };
  const m = label.match(/^(AUMA|Rotork) (.+)$/);
  const code = m && actByModel.get(`${m[1]}|${m[2].trim()}`);
  if (!m || !code) throw new Error(`SUITABILITY column "${label}" has no matching ACT_MASTER model.`);
  return { kind: "ACT" as const, make: m[1], code };
}

export const SPECS = { ACT, GB, VT, MAP, GBS, STK }

export function parseActuatorWorkbook(wb: XLSX.WorkBook): Parsed {
  const actuators = extract(table(wb, "ACT_MASTER", "ACT CODE"), ACT, (r) => !!r.actCode && !!r.make);
  const gearboxes = extract(table(wb, "GB_MASTER", "GB CODE"), GB, (r) => !!r.gbCode && !!r.make);

  const vt = table(wb, "VALVE_TORQUE", "KEY");
  const valveTorques = extract(vt, VT, (r) => !!r.key?.toString().includes("|"));
  const params = vt.rows
    .slice(0, vt.at)
    .filter((r) => text(r[0]) && num(r[1]) !== null)
    .map((r) => ({ name: text(r[0])!, value: num(r[1])!, note: text(r[2]) }));

  const mappings = extract(table(wb, "MAPPING", "MAP KEY"), MAP, (r) => !!r.mapKey?.toString().includes("|"));
  const gearboxStock = extract(table(wb, "GMD_GB_STOCK", "ERP ITEM CODE"), GBS, (r) => !!r.erpCode && !!r.gbType);

  const actByModel = new Map(actuators.map((a) => [`${a.make}|${a.model}`, a.actCode as string]));
  const actuatorStock = extract(table(wb, "STOCK_ACT", "ERP CODE"), STK, (r) => !!r.erpCode && !!r.series).map((r) => {
    // K-series rating code "K300/RPM24" -> ACT-RT-K300 (only when that model exists in ACT_MASTER).
    const k = String(r.ratingCode ?? "").match(/^(K\d+)/);
    return { ...r, actCode: (k && actByModel.get(`Rotork|${k[1]}`)) || null };
  });

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
  return { actuators, gearboxes, valveTorques, params, mappings, suitability, gearboxStock, actuatorStock };
}

export const readActuatorWorkbook = (path: string) => parseActuatorWorkbook(XLSX.readFile(path));

/** Workbook cells that only overwrite the DB when filled: a blank keeps what is already stored (prices, lead time, offers). */
export const KEEP_IF_BLANK = ["price", "leadTimeWeeks", "offerDate", "offerValidTill"];

/** Update object for an upsert: the row without blank KEEP_IF_BLANK cells. */
export const updateData = <T extends Record<string, unknown>>(row: T): Partial<T> =>
  Object.fromEntries(Object.entries(row).filter(([k, v]) => !(KEEP_IF_BLANK.includes(k) && v === null))) as Partial<T>;
