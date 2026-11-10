import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import type { ContractLine, StockItem } from "./types";

export type Pn = { cls: boolean; n: number } | null;
export interface ParsedLine {
  needs: string[]; metal: boolean; mat: "CS" | "FORGED" | "DI"; rising: boolean;
  drill: "9523" | "1538" | null; pn: Pn; size: number; actuated: boolean; time: number;
}
export interface ParsedStock {
  /** null = the row does not say (check valves, DPCVs…): seat is not checked. */
  vt: string; size: number; metal: boolean | null; mat: "CS" | "FORGED" | "DI"; rising: boolean;
  drill: "9523" | null; pn: Pn; kind: "finished" | "assemble" | null;
}

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

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
  return {
    needs: needsOf(item),
    metal: all.includes("METAL"),
    mat,
    rising: all.replace(/NON[- ]?RISING/g, "").includes("RISING"),
    drill: all.includes("9523") ? "9523" : all.includes("1538") ? "1538" : null,
    pn: parsePn(l.pnRating),
    size: parseInt(l.size ?? "", 10),
    actuated: /_ACT|ACT_|MOTORISED|ELECTRIC/.test(name) || !!l.actuator?.trim(),
    time: parseGmdDate(l.dateOfContract)?.getTime() ?? Infinity, // undated = newest
  };
}

export function parseStock(s: StockItem): ParsedStock {
  const comp = up(s.component), std = up(s.std), mat = up(s.material), cat = up(s.category);
  const finished = cat === "FINISHED VALVES" || up(s.itemType) === "FINISHED / COMPLETE VALVE";
  const assemble = comp === "LIGHT BBD" || up(s.erpCode).startsWith("RXA") ||
    ((cat === "SPARES" || cat === "SS SPARES") && !!s.valveType && !!s.dimension);
  const vt = up(s.valveType);
  // Sluice valve stock without a seat word is resilient (metal rows say METAL TO METAL).
  const metal = comp === "METAL TO METAL" || std.includes("METAL") ? true
    : comp === "METAL TO RUBBER" || std.includes("RUBBER") || vt === "SLUICE VALVE" ? false : null;
  return {
    vt,
    size: parseInt(s.dimension ?? "", 10),
    metal,
    mat: /CARBON|CAST STEEL/.test(mat) ? "CS" : mat.includes("FORGED") ? "FORGED" : "DI",
    rising: std.replace(/NON[- ]?RISING/g, "").includes("RISING"),
    drill: std.endsWith("-9523") ? "9523" : null,
    pn: parsePn(s.pn),
    kind: finished ? "finished" : assemble ? "assemble" : null,
  };
}
