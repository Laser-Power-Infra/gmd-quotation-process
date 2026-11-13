/**
 * Valve serial-no record: field list, standard pre-fill and tolerance check.
 * Pure: no Prisma import, so the page, the actions and the tests share it.
 *
 * Pre-fill priority (agreed with Puja, 31 Oct): Technicals -> Flange tab first,
 * then the Gate Valve tab (the in-app copy of the CONSOLIDATED_VALVES valve data)
 * for anything the Flange tab has no column for. Every field stays editable.
 */

/** "1,000" -> 1000, "+2" -> 2; blank or not a number -> null. */
function parseNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export const ID_FIELDS = [
  ["serialNo", "Serial No"],
  ["contractNo", "Contract No"],
  ["valveType", "Valve type"],
  ["sizeDn", "Size (DN)"],
  ["pnRating", "PN rating"],
] as const;

export const DIM_FIELDS = [
  ["odMm", "OD (mm)"],
  ["idMm", "ID (mm)"],
  ["pcdMm", "PCD (mm)"],
  ["boltHoles", "No. of bolt holes"],
  ["holeDiaMm", "Hole dia (mm)"],
  ["flangeThicknessMm", "Flange thickness (mm)"],
  ["faceToFaceMm", "Face-to-face (mm)"],
  ["heightOpenMm", "Height open (mm)"],
  ["heightClosedMm", "Height closed (mm)"],
  ["weightKg", "Weight (kg)"],
  ["flangeStandard", "Flange standard / drilling"],
  ["bodyMoc", "Body MOC"],
  ["discMoc", "Disc MOC"],
  ["seatMoc", "Seat MOC"],
  ["actuatorGearbox", "Actuator / gearbox"],
] as const;

/** Dates are ISO yyyy-mm-dd text (date inputs). Pressures pre-fill from the standard, never flagged. */
export const TEST_FIELDS = [
  ["testDate", "Test date"],
  ["bodyTestPressure", "Body test pressure"],
  ["seatTestPressure", "Seat test pressure"],
  ["testDuration", "Test duration"],
  ["testResult", "Test result"],
] as const;

/** Mostly imported from the "GMD DISPATCH SL NO" sheet; typed here once the sheet is frozen. */
export const DISPATCH_FIELDS = [
  ["itemCode", "Item code"],
  ["itemName", "Item name"],
  ["partyName", "Party name"],
  ["invoiceNo", "Invoice no"],
  ["invoiceDate", "Invoice date"],
  ["heatNo", "Heat no"],
  ["actuatorModel", "Actuator model"],
  ["actuatorSerial", "Actuator serial no"],
  ["gearboxModel", "Gearbox model"],
  ["gearboxSerial", "Gearbox serial no"],
  ["tcLink", "TC link"],
  ["remarks", "Remarks"],
] as const;

export const VALVE_SERIAL_FIELDS = [...ID_FIELDS, ...DIM_FIELDS, ...TEST_FIELDS, ...DISPATCH_FIELDS];
export type ValveSerialField = (typeof VALVE_SERIAL_FIELDS)[number][0];
export type ValveSerialView = Record<ValveSerialField, string | null>;

/** One standard value with its tolerance band (mm) and the Technicals tab it came from. */
export type StdValue = { value: string; plus: number | null; minus: number | null; source: "Flange" | "Gate Valve" };
export type ValveStandard = Partial<Record<ValveSerialField, StdValue>>;

type Row = Record<string, unknown>;

const key = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
// "DN 50", "50 MM" and "50" are the same size.
const size = (v: unknown) => parseNumber(String(v ?? "").replace(/^[^\d.]+/, ""));
/** The dispatch sheet gives PN in MPa ("1.6"); Technicals and the app use bar ("16"). Anything else is returned as is. */
export const mpaToBar = (v: string) => (/^\d\.\d+$/.test(v) ? String(Math.round(Number(v) * 10)) : v);
// "PN - 10", "PN10", "10" and "1.0" (MPa) are the same rating; "CLASS-300#" stays CLASS300.
const pn = (v: unknown) => mpaToBar(key(v).replace(/^PN/, ""));
// Tolerances arrive as "±2", "+1.0", "-1"; the sign is implied by the column.
const tol = (v: unknown) => parseNumber(String(v ?? "").replace(/[^\d.]/g, ""));

/** Standard values for a valve type + size + PN from the Flange and Gate Valve tab rows. */
export function pickStandard(
  input: { valveType?: string | null; sizeDn?: string | null; pnRating?: string | null; bodyMoc?: string | null },
  flangeRows: Row[],
  gateRows: Row[],
): ValveStandard {
  const s = size(input.sizeDn);
  if (s === null || !pn(input.pnRating)) return {};
  const match = (rowSize: unknown, rowPn: unknown) => size(rowSize) === s && pn(rowPn) === pn(input.pnRating);
  const flanges = flangeRows.filter((r) => match(r.size, r.pnRatingClass));
  // The Flange tab has one row per MOC; take the body MOC's row when it is known.
  const f = flanges.find((r) => input.bodyMoc && key(r.moc) === key(input.bodyMoc)) ?? flanges[0];
  // Gate Valve dimensions (face-to-face, weight) are only valid for gate/sluice valves; a knife gate valve is built differently.
  const t = input.valveType ?? "";
  const g = !/knife/i.test(t) && /gate|sluice/i.test(t) ? gateRows.find((r) => match(r.sizeMm, r.pnRatingClass)) : undefined;

  const std: ValveStandard = {};
  const put = (field: ValveSerialField, value: unknown, source: StdValue["source"], plus?: unknown, minus?: unknown) => {
    const v = String(value ?? "").trim();
    if (std[field] || !v) return;
    std[field] = { value: v, plus: tol(plus), minus: tol(minus), source };
  };
  if (f) {
    put("odMm", f.odMm, "Flange", f.odTolerancePlus, f.odToleranceMinus);
    put("idMm", f.idMm, "Flange", f.idTolerance, f.idTolerance);
    put("pcdMm", f.pcdMm, "Flange", f.pcdTolerance, f.pcdTolerance);
    put("boltHoles", f.noOfHoleNos, "Flange", "0", "0");
    put("holeDiaMm", f.holeDia, "Flange", f.holeDiaTolerancePlus, f.holeDiaToleranceMinus);
    put("flangeThicknessMm", f.thicknessOfFlange, "Flange", f.thicknessTolerancePlus, f.thicknessToleranceMinus);
    put("flangeStandard", f.standards, "Flange");
    put("bodyMoc", f.moc, "Flange");
    put("bodyTestPressure", f.bodyPressure, "Flange");
    put("seatTestPressure", f.seatPressure, "Flange");
  }
  if (g) {
    put("odMm", g.flangeOdMm, "Gate Valve", g.flangeOdTolerance, g.flangeOdTolerance);
    put("pcdMm", g.pcdMm, "Gate Valve", g.pcdTolerance, g.pcdTolerance);
    put("boltHoles", g.numberOfBolts, "Gate Valve", "0", "0");
    put("faceToFaceMm", g.faceToFaceLengthMm, "Gate Valve", g.faceToFaceLengthTolerance, g.faceToFaceLengthTolerance);
    put("weightKg", g.approxWeightKg, "Gate Valve");
    put("bodyMoc", g.material, "Gate Valve");
    put("bodyTestPressure", g.bodyPressure, "Gate Valve");
    put("seatTestPressure", g.seatPressure, "Gate Valve");
  }
  return std;
}

/**
 * Whether a save (re)takes the standard snapshot: on create, when the row has none or an
 * empty one (nothing matched then, e.g. imported before MPa PN matched), or when type, size
 * or PN change. Otherwise it is kept, so a Technicals re-sync cannot move a flag.
 */
export function needsStandard(existing: (Partial<ValveSerialView> & { standard: unknown }) | null, next: Partial<ValveSerialView>): boolean {
  if (!existing || JSON.stringify(existing.standard ?? {}) === "{}") return true;
  return (["valveType", "sizeDn", "pnRating"] as const).some((f) => existing[f] !== next[f]);
}

/** True when a measured number falls outside the standard's band. No band, or no number, is never flagged. */
export function outOfTolerance(measured: string | null | undefined, std: StdValue | undefined): boolean {
  if (!std || (std.plus === null && std.minus === null)) return false;
  const m = parseNumber(measured);
  const n = parseNumber(std.value);
  if (m === null || n === null) return false;
  const eps = 1e-9;
  return m > n + (std.plus ?? 0) + eps || m < n - (std.minus ?? 0) - eps;
}

/** Fields of a record whose measured value is out of tolerance. */
export const toleranceFlags = (view: Partial<ValveSerialView>, std: ValveStandard | null | undefined): ValveSerialField[] =>
  DIM_FIELDS.map(([f]) => f).filter((f) => outOfTolerance(view[f], std?.[f]));

/** "165 (+2/-2) · Flange" — the standard as shown next to an input and on the certificate. */
export function stdLabel(std: StdValue | undefined): string {
  if (!std) return "";
  const band = std.plus === null && std.minus === null ? "" : ` (+${std.plus ?? 0}/-${std.minus ?? 0})`;
  return `${std.value}${band} · ${std.source}`;
}

/** Trims every field to string-or-null; the serial no is required. */
export function normaliseValveSerial(input: Partial<ValveSerialView>): { data: ValveSerialView & { serialNo: string } } | { error: string } {
  const data = Object.fromEntries(
    VALVE_SERIAL_FIELDS.map(([f]) => [f, input[f]?.trim() || null]),
  ) as ValveSerialView;
  const { serialNo } = data;
  if (!serialNo) return { error: "Serial No is required." };
  return { data: { ...data, serialNo } };
}
