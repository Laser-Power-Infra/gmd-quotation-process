// GM R&D pricing rules (Puja Agarwal, 2026-11-02). One table, read by the red-row check
// and by the "Apply VA% rules" action. Rate = Contract Review (CR) rate, but VA% never
// drops below the minimum for the item and is never negative.
// Actuated items (Puja, 2026-11-18): only the bare valve carries VA%. The actuator portion (actuator +
// gearbox + adaptor + assembly, with the same loadings) gets a flat 5%: no minimum, no CR matching.
// Item type ACTUATOR (linked): VA% on the whole cost like any line, minimum 5, no CR matching.
// Actuator mark-up by valve size (Puja, 2026-11-23): that flat 5% (and the ACTUATOR minimum) is 10% from DN800,
// by the line's own size; a blank or unreadable size stays 5%.
import { parseSize } from "./vaValidation";
import { categorySeat, type SeatItem } from "./seatType";
import { isActuated } from "./actuatorCost";
import { BASE_COST_FACTOR } from "./costLoading";
import { roundUp } from "./rounding";

type ActuatorFields = Parameters<typeof isActuated>[0];

export interface VaItem extends SeatItem, ActuatorFields {
  size?: string | null;
  cost?: number | null;
  quotedRate?: string | null;
  vaPercent?: number | null;
  contractReviewRate?: string | null;
}

/** Minimum VA% for the item; 0 when no rule applies (so VA% is still never negative). */
export function minVaPercent(it: VaItem): number {
  const type = (it.itemType ?? "").toUpperCase().trim();
  const dn = parseSize(it.size);
  if (isActuatorOnly(it)) return actVaOfSize(it.size);
  // Seat from the item's own category only (BOQ / spec never move the minimum; seatMismatch warns instead).
  if (type.startsWith("SLUICE VALVE-")) return categorySeat(it) === "Resilient" ? 15 : 30;
  if (type === "CHECK VALVE") return categorySeat(it) === "Metal seated" ? 30 : 0;
  if (type === "BUTTERFLY VALVE") return dn !== null && dn > 450 ? 35 : 20;
  if (type === "TPAV" || type === "TPV") return 35;
  if (type === "EXPANSION BELOWS") return dn !== null && dn > 1000 ? 45 : 0;
  if (type === "DPCV") return dn !== null && dn > 600 ? 35 : 20;
  if (type === "PLUG VALVE") return 100;
  return 0;
}

/** The actuator portion's flat VA% by valve DN (10 above DN750); also the minimum (and blank-rate default) VA% of an item type ACTUATOR line. */
export const actVaPercent = (dn: number | null): 5 | 10 => (dn !== null && dn > 750 ? 10 : 5);

/** The same from a size text. The DN is the first number, as the actuator pick reads it (deriveMapKey): "DN500 PN16" is 500. Not parseSize, which joins every digit. */
export const actVaOfSize = (size: string | null | undefined): 5 | 10 => {
  const m = /\d+/.exec(size ?? "");
  return actVaPercent(m ? Number(m[0]) : null);
};

export type CostSplit = { valveCost: number; actCost: number; actVa: number };
// 5%: x 1.05 exactly as before 23 Nov, so no minimum rate up to DN750 moves by a paisa (x 105 / 100 differs in the last bit).
// Otherwise x (100 + actVa) / 100, not x 1.1: 2,00,000 x 1.1 is 2,20,000.00000000003 in floating point.
const actRate = (s: CostSplit) => (s.actVa === 5 ? s.actCost * 1.05 : (s.actCost * (100 + s.actVa)) / 100);

/** Linked item type ACTUATOR: no valve portion, so its VA% is on the whole cost (minimum 5, no CR matching). */
export const isActuatorOnly = (it: ActuatorFields) => isActuated(it) && (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR";

/** Loaded actuator portion (actuatorBreakdown.actCost): the parts carry the cost loadings; extension and bypass stay with the valve. */
export const loadedActCost = (productCost: number, bareValveCost: number, multiplier: number) =>
  parseFloat((Math.max(0, productCost - bareValveCost) * BASE_COST_FACTOR * (1 + multiplier)).toFixed(2));

/**
 * `cost` split into the valve and the actuator portion. Whole cost (actCost 0, maths unchanged) for a non-actuated
 * item, a legacy unlinked row, one priced before the split (no actuatorBreakdown.actCost yet), an item type ACTUATOR
 * line, and a valve whose actuator portion leaves no valve portion (its valve minimum then applies to the whole cost).
 */
export function splitLoadedCost(it: ActuatorFields & { size?: string | null }, cost: number): CostSplit {
  const actVa = actVaOfSize(it.size);
  const act = isActuated(it) && !isActuatorOnly(it) ? Number((it.actuatorBreakdown as { actCost?: unknown } | null | undefined)?.actCost) || 0 : 0;
  // A valve portion under Rs 1 is rounding (cost and actCost are each rounded to 2 dp), not a valve: whole cost.
  return act > 0 && cost - act >= 1 ? { valveCost: cost - act, actCost: act, actVa } : { valveCost: cost, actCost: 0, actVa };
}

/** Rate for a VA% on the valve portion; the actuator portion always gets its own flat 5% or 10% (s.actVa). */
export const rateFor = (s: CostSplit, va: number) => roundUp(s.valveCost * (1 + va / 100) + actRate(s));

/** Valve VA% behind a rate (2 dp); the whole-cost VA% when there is no split. */
export const vaFrom = (rate: number, s: CostSplit) => parseFloat(((((rate - actRate(s)) / s.valveCost) - 1) * 100).toFixed(2));

const num = (v: string | null | undefined) => parseFloat((v ?? "").replace(/[^0-9.]/g, ""));
const crRate = (it: VaItem) => (isActuatorOnly(it) ? 0 : num(it.contractReviewRate)); // item type ACTUATOR: no CR matching
const EPS = 0.005;
const floorRate = (it: VaItem, s = splitLoadedCost(it, it.cost!)) =>
  Math.ceil((s.valveCost * (1 + minVaPercent(it) / 100) + actRate(s)) * 100) / 100;

/**
 * Rate the rules want: CR rate (else the current rate), capped at the previous rate quoted
 * to the same party, then lifted to the minimum-VA% rate. The minimum wins over the cap.
 * Actuated: the same on the whole rate, which is the valve rule plus the fixed actuator portion x 1.05.
 */
export function vaRuleRate(it: VaItem, previousRate?: number | null): number | null {
  const quoted = num(it.quotedRate);
  const cr = crRate(it);
  if (!(it.cost! > 0)) return null;
  const s = splitLoadedCost(it, it.cost!);
  const base = cr > 0 ? cr : quoted > 0 ? quoted : floorRate(it, s);
  return Math.max(floorRate(it, s), previousRate && previousRate > 0 ? Math.min(base, previousRate) : base);
}

/** Red row: VA% below the minimum (or negative), rate above the CR rate, or a DN800+ valve rate below the rate its own VA% gives. No upper VA% limit. */
export function isVaRuleViolation(it: VaItem): boolean {
  if (it.vaPercent == null || !(it.cost! > 0)) return false;
  if (it.vaPercent < minVaPercent(it) - EPS) return true;
  if (actuatorMarkupShort(it)) return true;
  const quoted = num(it.quotedRate);
  const cr = crRate(it);
  return cr > 0 && quoted > Math.max(cr, floorRate(it)) + EPS;
}

/**
 * Red for the DN800+ actuator mark-up alone (the validation refusal names this reason): an item type ACTUATOR line
 * under VA% 10, or a valve line whose VA% meets its minimum but whose rate was built with the old 5% on the actuator portion.
 * Never re-priced here. Only the 10% case, so no line up to DN750 can change colour.
 */
export function actuatorMarkupShort(it: VaItem): boolean {
  if (it.vaPercent == null || !(it.cost! > 0)) return false;
  const s = splitLoadedCost(it, it.cost!);
  if (s.actVa !== 10) return false;
  if (isActuatorOnly(it)) return it.vaPercent < 10 - EPS;
  const quoted = num(it.quotedRate);
  // Against the rate its own VA% gives (not only the minimum), so a line above its minimum is caught too.
  // Rs 5 = the Rs 10 rounding of rateFor; 0.005% of the valve = the 2 dp rounding of a VA% derived from a typed / CR rate.
  return it.vaPercent >= minVaPercent(it) - EPS && s.actCost > 0 && quoted > 0 && quoted < rateFor(s, it.vaPercent) - 5 - s.valveCost * 0.00005 - EPS;
}

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Chip line under Cost: "Valve 1,20,000 @ 35% + Actuator 2,10,000 @ 5%"; null when there is no actuator portion. */
export function costSplitText(it: VaItem): string | null {
  const s = splitLoadedCost(it, Number(it.cost) || 0);
  if (!(s.actCost > 0)) return null;
  return `Valve ${inr(s.valveCost)}${it.vaPercent != null ? ` @ ${it.vaPercent}%` : ""} + Actuator ${inr(s.actCost)} @ ${s.actVa}%`;
}
