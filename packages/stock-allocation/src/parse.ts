import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import type { ContractLine, StockItem } from "./types";

export type Pn = { cls: boolean; n: number } | null;
/** The part an actuated line needs besides its valve, and the type an ACTUATORS stock row supplies. */
export const ACTUATOR = "ACTUATOR";
export interface ParsedLine {
  needs: string[]; metal: boolean; mat: "CS" | "FORGED" | "DI"; rising: boolean; wafer: boolean;
  drill: "9523" | "1538"; pn: Pn; size: number; actuated: boolean;
  /** MC date and contract date (ms); undated = Infinity. */
  mcTime: number; time: number;
  /** actKey of the Actuator field; null when blank. */
  act: string | null;
  /** Model + RPM part of the Actuator field; null when blank or unclear. */
  actModel: string | null;
}
export interface ParsedStock {
  /** null = the row does not say (check valves, DPCVs…): seat is not checked. */
  vt: string; size: number; metal: boolean | null; mat: "CS" | "FORGED" | "DI"; rising: boolean; wafer: boolean;
  drill: "9523" | "1538"; pn: Pn;
  /** "finished" = a finished valve or an actuator; null = a part or anything else, never a valve on its own. */
  kind: "finished" | null;
  /** actKey of an ACTUATORS row (L7 + L6); null for every other row. */
  act: string | null;
  actModel: string | null;
}

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

/** One key per actuator model whatever the order of its two parts ("L7@L6" on the line); null when a part is blank. */
export function actKey(a: string | null | undefined, b: string | null | undefined): string | null {
  const parts = [a, b].map((p) => up(p).trim().replace(/\s+/g, " "));
  return parts.every(Boolean) ? parts.sort().join("@") : null;
}

/** Model + RPM of an actuator ("K30/RPM24"): the one part that says RPM, the other being the wiring; null when unclear. */
function actModel(l7: string | null | undefined, l6: string | null | undefined): string | null {
  const [a, b] = [l7, l6].map((p) => up(p).trim().replace(/\s+/g, " "));
  return a && b && a.includes("RPM") !== b.includes("RPM") ? (a.includes("RPM") ? a : b) : null;
}

function parsePn(s: string | null): Pn {
  const t = up(s);
  const n = parseInt(t.replace(/\D*(\d+).*/, "$1"), 10);
  if (isNaN(n)) return null;
  return { cls: t.includes("CLASS"), n };
}

function needsOf(item: string): string[] {
  if (item.startsWith("TPAV+SLV")) return ["TPAV", "SLUICE VALVE"];
  if (item.startsWith("SLV")) return ["SLUICE VALVE"];
  if (item.startsWith("BFV")) return ["BUTTERFLY VALVE"];
  if (item.startsWith("TPAV")) return ["TPAV"];
  if (item.startsWith("NRV")) return ["CHECK VALVE"];
  if (item.startsWith("DPCV")) return ["DPCV"];
  if (item.startsWith("PRV")) return ["PRESSURE REDUCING VALVE"];
  if (item.startsWith("GLOBE VALVE")) return ["GLOBE VALVE"];
  if (item === "CF" || item.startsWith("CF ")) return ["COMPANION FLANGE"];
  return []; // not stocked
}

export function parseLine(l: ContractLine): ParsedLine {
  const item = up(l.item).trim(), name = up(l.itemName), all = `${item} ${name}`;
  const mat = /CAST STEEL|CARBON STEEL/.test(name) || /\bCS\b|CAST STEEL/.test(item) ? "CS"
    : all.includes("FORGED") ? "FORGED" : "DI";
  // only an "L7@L6" model counts ("-", "NA", "#N/A", "MANUAL" are placeholders), as in contractReviewBackfill
  const actuated = /_ACT|ACT_|MOTORISED|ELECTRIC/.test(name) || !!l.actuator?.includes("@");
  const valves = needsOf(item), [a, b] = (l.actuator ?? "").split("@");
  return {
    // an actuated valve needs its actuator too; an actuator alone never makes a line ready
    needs: actuated && valves.length ? [...valves, ACTUATOR] : valves,
    metal: all.includes("METAL"),
    mat,
    rising: all.replace(/NON[- ]?RISING/g, "").includes("RISING"),
    wafer: all.includes("WAFER"),
    drill: all.includes("9523") ? "9523" : "1538", // a line that does not say 9523 is IS 1538 drilling
    pn: parsePn(l.pnRating),
    size: parseInt(l.size ?? "", 10),
    actuated,
    mcTime: parseGmdDate(l.mcDate)?.getTime() ?? Infinity, // undated = newest
    time: parseGmdDate(l.dateOfContract)?.getTime() ?? Infinity,
    act: actKey(a, b),
    actModel: actModel(a, b),
  };
}

export function parseStock(s: StockItem): ParsedStock {
  const comp = up(s.component), std = up(s.std), mat = up(s.material), cat = up(s.category);
  const finished = cat === "FINISHED VALVES" || up(s.itemType) === "FINISHED / COMPLETE VALVE";
  const vt = up(s.valveType), act = cat === "ACTUATORS" ? actKey(s.pn, s.std) : null;
  // Sluice valve stock without a seat word is resilient (metal rows say METAL TO METAL).
  const metal = comp === "METAL TO METAL" || std.includes("METAL") ? true
    : comp === "METAL TO RUBBER" || std.includes("RUBBER") || vt === "SLUICE VALVE" ? false : null;
  return {
    vt: act ? ACTUATOR : vt,
    size: parseInt(s.dimension ?? "", 10),
    metal,
    mat: /CARBON|CAST STEEL/.test(mat) ? "CS" : mat.includes("FORGED") ? "FORGED" : "DI",
    rising: std.replace(/NON[- ]?RISING/g, "").includes("RISING"),
    wafer: `${comp} ${std}`.includes("WAFER"),
    drill: std.includes("9523") ? "9523" : "1538",
    pn: parsePn(s.pn),
    kind: finished || act ? "finished" : null, // a bought-out actuator is ready as it stands
    act,
    actModel: act ? actModel(s.pn, s.std) : null,
  };
}
