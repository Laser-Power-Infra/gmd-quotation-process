// Pure rules linking a docket item to the actuator master (no DB): MAP KEY, code pick, cost build-up, offer rule.
// Blank price = "price pending", never 0: a pending item has no total.
import { matchItemType } from "./itemTypePatterns";

export const SPECIAL_OEM = "Special – refer OEM";
export const DEFAULT_MAKE = "AUMA"; // used when the item has no actuator_make yet (user can change it)
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

/** Op types that make a valve item actuated. The gearbox is NOT decided here: it follows the MAPPING row. */
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
  const pn = /^\D*(\d+)\D*$/.exec(it.pnRating ?? "")?.[1]; // "PN-10/16" has two numbers: not derivable
  return type && dn && pn ? `${type}|${Number(dn)}|PN${pn}` : null;
}

export interface MappingRow { gearbox?: string | null; aumaActCode?: string | null; rotorkActCode?: string | null }
export interface GearboxRow { gbCode: string; model?: string | null; dataStatus?: string | null }

/** Codes to fill for one item. `special` = refer OEM: no code, no cost. */
export function pickCodes(m: MappingRow, make: string | null | undefined, gearboxes: GearboxRow[]) {
  const chosen = make === "Rotork" ? "Rotork" : make === "AUMA" ? "AUMA" : DEFAULT_MAKE;
  if (/special/i.test(m.gearbox ?? "")) return { special: true, make: chosen, actCode: null, gbCode: null, gbWanted: false, gbMissing: false };
  const actCode = (chosen === "Rotork" ? m.rotorkActCode : m.aumaActCode) ?? null;
  const direct = !m.gearbox || /^[—–-]/.test(m.gearbox.trim()); // "— (direct)"
  // GB-RT-IW is a "Range only" placeholder: never picked.
  const gb = !direct ? gearboxes.find((g) => g.model === m.gearbox && g.gbCode !== "GB-RT-IW" && !/range only/i.test(g.dataStatus ?? "")) : undefined;
  return { special: false, make: chosen, actCode, gbCode: gb?.gbCode ?? null, gbWanted: !direct, gbMissing: !direct && !gb };
}

/** Latest offer wins (same rule as CONSOLIDATED_VALVES latest quote); an undated offer never beats a dated one. */
export function latestOffer(existing: Date | null, incoming: Date | null): boolean {
  if (!incoming) return !existing;
  return !existing || incoming.getTime() >= existing.getTime();
}

export interface CostInput {
  actuatorItem: boolean; // Item type ACTUATOR: actuator + gearbox only, no bare valve
  special?: boolean;
  bare: number | null;
  act: { code: string | null; price: number | null; validTill?: Date | null } | null;
  gb: { code: string | null; price: number | null } | null; // null = no gearbox for this item
  adaptor?: number | null;
  assembly?: number | null;
  now?: Date;
}
export interface CostResult { total: number | null; parts: { label: string; amount: number | null }[]; pending: string[]; text: string }

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

export function buildActuatorCost(i: CostInput): CostResult {
  const parts: CostResult["parts"] = [];
  const pending: string[] = [];
  const add = (label: string, amount: number | null | undefined, missing: string) => {
    if (amount == null) { pending.push(missing); parts.push({ label, amount: null }); } else parts.push({ label, amount });
  };
  if (i.special) {
    pending.push(SPECIAL_OEM);
  } else {
    if (!i.actuatorItem) add("Valve", i.bare, "bare valve cost");
    if (!i.act?.code) pending.push("actuator code");
    else add(`ACT ${i.act.code}`, i.act.price, `actuator price (${i.act.code})`);
    if (i.gb) {
      if (!i.gb.code) pending.push("gearbox code");
      else add(`GB ${i.gb.code}`, i.gb.price, `gearbox price (${i.gb.code})`);
    }
    if (i.adaptor) parts.push({ label: "Adaptor/coupling", amount: i.adaptor });
    if (i.assembly) parts.push({ label: "Assembly & testing", amount: i.assembly });
  }
  const total = pending.length ? null : parts.reduce((s, p) => s + p.amount!, 0);
  const expired = i.act?.validTill && i.act.validTill < (i.now ?? new Date()) ? ` (offer for ${i.act.code} expired)` : "";
  const text = pending.length
    ? `Price pending: ${pending.join(", ")}`
    : `${parts.map((p) => `${p.label} ${inr(p.amount!)}`).join(" + ")} = ${inr(total!)}${expired}`;
  return { total, parts, pending, text };
}

export interface PlanItem {
  itemType?: string | null; itemName?: string | null; size?: string | null; pnRating?: string | null;
  actuatorMake?: string | null; actCode?: string | null; gbCode?: string | null;
  productCost: number | null; bareValveCost: number | null; lastTotal: number | null;
  adaptorCost?: number | null; assemblyCost?: number | null;
}
// rederive: the MAP KEY changed, so the old auto codes are dropped and re-picked from MAPPING.
export interface PlanPatch { actuatorMake?: string | null; actCode?: string | null; gbCode?: string | null; rederive?: boolean }

/** Everything applyActuatorToItem writes, decided without a DB: codes, bare valve, cost build-up, reason. */
export function planActuator(
  it: PlanItem, patch: PlanPatch,
  mapping: MappingRow | null, gearboxes: GearboxRow[],
  prices: { act: { price: number | null; validTill?: Date | null } | null; gb: { price: number | null } | null },
) {
  const actuatorItem = (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR";
  let make = patch.actuatorMake !== undefined ? patch.actuatorMake : it.actuatorMake ?? null;
  let actCode = patch.actCode !== undefined ? patch.actCode : patch.rederive ? null : it.actCode ?? null;
  let gbCode = patch.gbCode !== undefined ? patch.gbCode : patch.rederive ? null : it.gbCode ?? null;
  const makeChanged = patch.actuatorMake !== undefined && patch.actuatorMake !== (it.actuatorMake ?? null);
  const key = deriveMapKey(it);
  let special = false;
  let reason: string | null = null;
  let gbWanted = !!gbCode; // no MAPPING row: only a code typed by hand asks for a gearbox
  if (!mapping) {
    if (!actCode) reason = key ? `No MAPPING row for ${key}` : "MAP KEY not derivable (needs a valve type, size and a single PN)";
  } else {
    const pick = pickCodes(mapping, make, gearboxes);
    special = pick.special;
    gbWanted = pick.gbWanted || !!gbCode;
    if (pick.special) { make = pick.make; actCode = null; gbCode = null; } // Special - refer OEM: no auto-fill
    else {
      // Fill-only: a hand-entered code is kept; a make change re-picks both codes.
      if (patch.actCode === undefined && (makeChanged || !actCode)) actCode = pick.actCode;
      if (patch.gbCode === undefined && (makeChanged || !gbCode)) gbCode = pick.gbCode;
      make = make ?? pick.make;
      if (!actCode) reason = `No ${pick.make} actuator code in MAPPING for ${key}`;
      else if (pick.gbMissing && !gbCode) reason = `Gearbox "${mapping.gearbox}" is not in the gearbox master`;
    }
  }
  // The valve's own cost: a productCost that is not our last total was set by someone else (BOM fill, hand edit).
  const bare = actuatorItem ? null : bareValveOf(it);
  const cost = buildActuatorCost({
    actuatorItem, special, bare,
    act: actCode ? { code: actCode, price: prices.act?.price ?? null, validTill: prices.act?.validTill } : null,
    gb: gbWanted ? { code: gbCode, price: prices.gb?.price ?? null } : null,
    adaptor: it.adaptorCost, assembly: it.assemblyCost,
  });
  if (reason && !special) cost.text = `${cost.text} [${reason}]`;
  return { make, actCode, gbCode, special, bare, cost, reason };
}

/** What the 2:1 cost fill writes: `cost` as before, but for an actuated item the sum is the valve cost (productCost), so the actuator parts are added. */
export const twoToOneUpdate = (it: Parameters<typeof isActuated>[0], sum: number): { cost: number } | { productCost: number } =>
  isActuated(it) ? { productCost: sum } : { cost: sum };

/** The update minus productCost, or null when nothing else was passed. */
export function withoutProductCost<T extends { productCost?: unknown }>(updates: T): Omit<T, "productCost"> | null {
  const { productCost: _drop, ...rest } = updates;
  return Object.values(rest).some((v) => v !== undefined) ? rest : null;
}
