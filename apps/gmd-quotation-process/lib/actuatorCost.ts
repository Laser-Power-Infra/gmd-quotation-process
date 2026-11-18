// Pure rules linking a docket item to the actuator master (no DB): MAP KEY, cost build-up, offer rule.
// The actuator / gearbox pick itself is in actuatorSelect.ts. Blank price = "price pending", never 0: a pending item has no total.
import { matchItemType } from "./itemTypePatterns";
import type { Selection } from "./actuatorSelect";

export const SPECIAL_OEM = "Special – refer OEM";
export const CONTROL_TYPES = ["On-off", "Modulating", "Integral intelligent"] as const;

// MAPPING valve-type keys. SLUICE = metal sluice, SLUICE-RS = resilient-seated sluice, KGV = knife gate.
function mapType(itemType: string | null | undefined): string | null {
  const t = (itemType ?? "").toUpperCase();
  if (t === "BUTTERFLY VALVE") return "BFV";
  if (t.startsWith("SLUICE VALVE-METAL")) return "SLUICE";
  if (t.startsWith("SLUICE VALVE-RESILIENT")) return "SLUICE-RS";
  if (t === "KNIFE GATE VALVE") return "KGV";
  return null;
}

/** Op types that make a valve item actuated. The gearbox is NOT decided here: it comes with ACT+GB (actuatorSelect.ts). */
export function actuatorOp(op: string | null | undefined): { act: boolean } {
  const o = (op ?? "").trim().toUpperCase();
  return { act: o === "ACT" || o === "ACT+GB" || o === "ELECTRIC" };
}

/** Could be actuated: Op Type ACT / ACT+GB / ELECTRIC, or Item type ACTUATOR. Only Fetch Actuator / auto-fill may link such an item. */
export const isActuatorCandidate = (it: { operationType?: string | null; itemType?: string | null }) =>
  actuatorOp(it.operationType).act || (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR";

/** Linked = auto-fill or Fetch Actuator has run (codes or breakdown, incl. the Special-refer-OEM marker). */
export const hasActuatorLink = (it: { actCode?: string | null; gbCode?: string | null; actuatorBreakdown?: unknown }) =>
  !!(it.actCode || it.gbCode || it.actuatorBreakdown != null);

/** Actuated for costing / BOM skipping = candidate AND linked. A legacy ACT row with no link keeps its old behaviour. */
export const isActuated = (it: { operationType?: string | null; itemType?: string | null; actCode?: string | null; gbCode?: string | null; actuatorBreakdown?: unknown }) =>
  isActuatorCandidate(it) && hasActuatorLink(it);

/** The valve's own cost: a productCost that is not our last total was set by someone else (BOM fill, hand edit). Never a total. */
export const bareValveOf = (it: { productCost: number | null; bareValveCost: number | null; lastTotal: number | null }): number | null =>
  it.productCost != null && !(it.lastTotal != null && Math.abs(it.productCost - it.lastTotal) < 0.01) ? it.productCost : it.bareValveCost;

/** TYPE|DN|PN. An ACTUATOR line has no valve type of its own, so it is read from the details (item name). */
export function deriveMapKey(it: { itemType?: string | null; itemName?: string | null; size?: string | null; pnRating?: string | null }): string | null {
  const isActuator = (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR";
  const type = mapType(isActuator ? matchItemType(it.itemName) : it.itemType);
  const dn = /\d+/.exec(it.size ?? "")?.[0];
  // Dual rating "PN-10/16": the higher one sizes the actuator (PN16). Anything else with two numbers ("PN 1.6") is not derivable.
  const list = /^\D*(\d+(?:\s*\/\s*\d+)*)\D*$/.exec(it.pnRating ?? "")?.[1];
  const pn = list && Math.max(...list.split("/").map(Number));
  return type && dn && pn ? `${type}|${Number(dn)}|PN${pn}` : null;
}

/** Latest offer wins (same rule as CONSOLIDATED_VALVES latest quote); an undated offer never beats a dated one. */
export function latestOffer(existing: Date | null, incoming: Date | null): boolean {
  if (!incoming) return !existing;
  return !existing || incoming.getTime() >= existing.getTime();
}

export interface CostResult { total: number | null; parts: { label: string; amount: number | null }[]; pending: string[]; text: string }
export interface ActuatorPick { selection: Selection; missing: string[] }

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Valve + actuator + gearbox + adaptor + assembly, each part shown (ACTUATOR item: no valve). Anything missing = price pending, no total. */
export function buildActuatorCost(pick: ActuatorPick, bare: number | null, actuatorItem: boolean): CostResult {
  const s = pick.selection;
  if (s.status === "OEM RFQ") return { total: null, parts: [], pending: [SPECIAL_OEM], text: `Price pending: ${SPECIAL_OEM}` };
  const est = (x: { estimated: boolean }) => (x.estimated ? " (est.)" : "");
  const stock = (p: { source: string; erpCode: string | null }) => (p.source === "stock" && p.erpCode ? ` (stock ${p.erpCode})` : "");
  const parts: CostResult["parts"] = [
    ...(actuatorItem ? [] : [{ label: "Valve", amount: bare }]),
    ...(s.act ? [{ label: `ACT ${s.act.make} ${s.act.model ?? ""}${stock(s.act)}`, amount: s.act.rate }] : []),
    ...(s.gb ? [{ label: `GB ${s.gb.source === "viral" ? "Viral " : ""}${s.gb.model ?? ""}${stock(s.gb)}`, amount: s.gb.rate }] : []),
    ...(s.adaptor ? [{ label: `Adaptor/coupling${est(s.adaptor)}`, amount: s.adaptor.amount }] : []),
    ...(s.assembly ? [{ label: `Assembly & testing${est(s.assembly)}`, amount: s.assembly.amount }] : []),
  ];
  const pending = [...(!actuatorItem && bare == null ? ["bare valve cost"] : []), ...pick.missing];
  const total = pending.length ? null : parts.reduce((t, p) => t + p.amount!, 0);
  const flags = s.flags.length ? ` [${s.flags.join("; ")}]` : "";
  const text = pending.length
    ? `Price pending: ${pending.join(", ")}${flags}`
    : `${parts.map((p) => `${p.label} ${inr(p.amount!)}`).join(" + ")} = ${inr(total!)}${flags}`;
  return { total, parts, pending, text };
}

export interface PlanItem { itemType?: string | null; productCost: number | null; bareValveCost: number | null; lastTotal: number | null }

/** Everything applyActuatorToItem writes, decided without a DB: bare valve, cost build-up, the item's make and codes. */
export function planActuator(it: PlanItem, pick: ActuatorPick, hand: { make?: string | null; actCode?: string | null; gbCode?: string | null } = {}) {
  const actuatorItem = (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR";
  // The valve's own cost: a productCost that is not our last total was set by someone else (BOM fill, hand edit).
  const bare = actuatorItem ? null : bareValveOf(it);
  const s = pick.selection;
  const oem = s.status === "OEM RFQ"; // refer OEM: no codes, no cost
  return {
    bare, cost: buildActuatorCost(pick, bare, actuatorItem),
    make: hand.make ?? (s.aumaRequired ? "AUMA" : "Rotork"),
    actCode: oem ? null : hand.actCode ?? s.act?.actCode ?? s.act?.model ?? null,
    gbCode: oem ? null : hand.gbCode ?? s.gb?.gbCode ?? null,
  };
}

/** What the 2:1 cost fill writes: `cost` as before, but for an actuated item the sum is the valve cost (productCost), so the actuator parts are added. */
export const twoToOneUpdate = (it: Parameters<typeof isActuated>[0], sum: number): { cost: number } | { productCost: number } =>
  isActuated(it) ? { productCost: sum } : { cost: sum };

/**
 * A hand-typed product cost on an actuated item is stored as the valve-only cost, and productCost stays blank
 * while the actuator price is pending. This is that saved valve cost, so the cell can still show it; null otherwise.
 */
export function pendingValveCost(it: { productCost?: number | string | null; bareValveCost?: number | string | null; actuatorBreakdown?: unknown }): number | null {
  if (it.productCost != null || it.bareValveCost == null) return null;
  const pending = (it.actuatorBreakdown as { pending?: unknown[] } | null | undefined)?.pending;
  return Array.isArray(pending) && pending.length > 0 ? Number(it.bareValveCost) : null;
}

/** The update minus productCost, or null when nothing else was passed. */
export function withoutProductCost<T extends { productCost?: unknown }>(updates: T): Omit<T, "productCost"> | null {
  const { productCost: _drop, ...rest } = updates;
  return Object.values(rest).some((v) => v !== undefined) ? rest : null;
}
