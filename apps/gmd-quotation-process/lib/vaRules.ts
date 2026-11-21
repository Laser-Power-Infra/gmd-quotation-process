// GM R&D pricing rules (Puja Agarwal, 2026-11-02). One table, read by the red-row check
// and by the "Apply VA% rules" action. Rate = Contract Review (CR) rate, but VA% never
// drops below the minimum for the item and is never negative.
// Actuated items (Puja, 2026-11-18): only the bare valve carries VA%. The actuator portion (actuator +
// gearbox + adaptor + assembly, with the same loadings) gets a flat 5%: no minimum, no CR matching.
// Item type ACTUATOR (linked): VA% on the whole cost like any line, minimum 5, no CR matching.
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
  if (isActuatorOnly(it)) return ACT_VA;
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

/** The actuator portion's flat VA%; also the minimum (and blank-rate default) VA% of an item type ACTUATOR line. */
export const ACT_VA = 5;
const ACT_RATE = 1 + ACT_VA / 100;

export type CostSplit = { valveCost: number; actCost: number };

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
export function splitLoadedCost(it: ActuatorFields, cost: number): CostSplit {
  const act = isActuated(it) && !isActuatorOnly(it) ? Number((it.actuatorBreakdown as { actCost?: unknown } | null | undefined)?.actCost) || 0 : 0;
  // A valve portion under Rs 1 is rounding (cost and actCost are each rounded to 2 dp), not a valve: whole cost.
  return act > 0 && cost - act >= 1 ? { valveCost: cost - act, actCost: act } : { valveCost: cost, actCost: 0 };
}

/** Rate for a VA% on the valve portion; the actuator portion always gets 5%. */
export const rateFor = (s: CostSplit, va: number) => roundUp(s.valveCost * (1 + va / 100) + s.actCost * ACT_RATE);

/** Valve VA% behind a rate (2 dp); the whole-cost VA% when there is no split. */
export const vaFrom = (rate: number, s: CostSplit) => parseFloat(((((rate - s.actCost * ACT_RATE) / s.valveCost) - 1) * 100).toFixed(2));

const num = (v: string | null | undefined) => parseFloat((v ?? "").replace(/[^0-9.]/g, ""));
const crRate = (it: VaItem) => (isActuatorOnly(it) ? 0 : num(it.contractReviewRate)); // item type ACTUATOR: no CR matching
const EPS = 0.005;
const floorRate = (it: VaItem, s = splitLoadedCost(it, it.cost!)) =>
  Math.ceil((s.valveCost * (1 + minVaPercent(it) / 100) + s.actCost * ACT_RATE) * 100) / 100;

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

/** Red row: VA% below the minimum (or negative), or rate above the CR rate. No upper VA% limit. */
export function isVaRuleViolation(it: VaItem): boolean {
  if (it.vaPercent == null || !(it.cost! > 0)) return false;
  if (it.vaPercent < minVaPercent(it) - EPS) return true;
  const quoted = num(it.quotedRate);
  const cr = crRate(it);
  return cr > 0 && quoted > Math.max(cr, floorRate(it)) + EPS;
}

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Chip line under Cost: "Valve 1,20,000 @ 35% + Actuator 2,10,000 @ 5%"; null when there is no actuator portion. */
export function costSplitText(it: VaItem): string | null {
  const s = splitLoadedCost(it, Number(it.cost) || 0);
  if (!(s.actCost > 0)) return null;
  return `Valve ${inr(s.valveCost)}${it.vaPercent != null ? ` @ ${it.vaPercent}%` : ""} + Actuator ${inr(s.actCost)} @ ${ACT_VA}%`;
}
