// Picks the actuator and gearbox of one docket item from the live master. Pure: no DB, no fetch (actuatorItem.ts reads).
// Stock first (a line with enough free qty), else new; the smallest rating that is big enough wins.
import type { Parsed } from "./actuatorMaster";
import { SPECIAL_OEM } from "./actuatorCost";
import { isErpCode } from "./actuatorStock";

export const RATE_FLAG = "rate increase – negotiate";
export const HAND_ACT = "actuator set by hand";
export const HAND_GB = "gearbox set by hand";

type Row = Record<string, string | number | null>;
export type Master = Pick<Parsed, "mappings" | "actuators" | "gearboxes" | "viralGearboxes" | "actuatorStock" | "gearboxStock">;

interface Rate { rate: number | null; rateSource: "RM" | "SHEET" | null; rateFlag: string | null }
export interface ActPick extends Rate { source: "stock" | "rotork" | "auma"; make: string; model: string | null; erpCode: string | null; actCode: string | null; torque: number | null }
export interface GbPick extends Rate { source: "stock" | "viral"; model: string | null; erpCode: string | null; gbCode: string | null; torque: number | null }
type Extra = { amount: number; estimated: boolean } | null;

/** Stored as actuatorBreakdown.selection; the offer line and the OEM RFQ read it. */
export interface Selection {
  status: "OK" | "PENDING" | "OEM RFQ";
  mapKey: string | null; valveType: string | null; dn: number | null; pn: string | null; qty: number;
  requiredTorque: number | null; actNeed: number | null; topFlange: string | null;
  act: ActPick | null; gb: GbPick | null; adaptor: Extra; assembly: Extra;
  aumaRequired: boolean; flags: string[];
}

export interface SelectInput {
  mapKey: string | null;
  op: string | null; // Op Type: the gearbox comes with ACT+GB only (or a GB CODE typed by hand)
  actuatorItem: boolean; // Item type ACTUATOR: actuator + gearbox only, no adaptor / assembly
  qty: number; // docket qty: a stock line needs this much free
  text: string; // item text (BOQ line): decides AUMA or Rotork
  make?: string | null; actCode?: string | null; gbCode?: string | null; // typed by hand, see handPicks
  adaptor?: number | null; assembly?: number | null; // typed by hand: win over the estimates
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const same = (v: unknown, s: string) => str(v)?.toUpperCase() === s.toUpperCase();

/** Adaptor plate + coupling per set, by the valve top flange (largest F size in the cell: "F07/F10" is F10). */
export function adaptorEstimate(flange: string | null): number | null {
  const f = Math.max(...[...(flange ?? "").matchAll(/F\s*(\d+)/gi)].map((x) => Number(x[1])));
  return !Number.isFinite(f) ? null : f <= 10 ? 1500 : f <= 14 ? 2500 : f <= 16 ? 3500 : f <= 25 ? 6000 : 10000;
}

/** Assembly & testing per valve, by DN. */
export const assemblyEstimate = (dn: number | null): number | null =>
  dn && dn > 0 ? (dn <= 300 ? 1500 : dn <= 600 ? 3000 : dn <= 1000 ? 5000 : 8000) : null;

/**
 * `missing` lists what keeps the actuator side from a price (empty = status OK). `free` = free qty per ERP code
 * (live stock minus allocations), `rm` = Raw Material master rate per ERP code.
 */
export function selectActuator(i: SelectInput, m: Master, free: Map<string, number>, rm: Map<string, number>): { selection: Selection; missing: string[] } {
  const [valveType = null, dn = null, pn = null] = i.mapKey?.split("|") ?? [];
  const row = m.mappings.find((r) => r.mapKey === i.mapKey);
  // No approved-make list is recorded: a "Rotork" in the same text counts as Rotork being allowed.
  const aumaRequired = /\bAUMA\b/i.test(i.text) && !/\bROTORK\b/i.test(i.text);
  const make = same(i.make, "AUMA") ? "AUMA" : same(i.make, "Rotork") ? "Rotork" : aumaRequired ? "AUMA" : "Rotork";
  const requiredTorque = num(row?.requiredTorque);
  const sel: Selection = {
    status: "PENDING", mapKey: i.mapKey, valveType, dn: dn ? Number(dn) : null, pn, qty: i.qty, requiredTorque, actNeed: null,
    topFlange: str(row?.valveFlange), act: null, gb: null, adaptor: null, assembly: null, aumaRequired, flags: [],
  };
  if (/special/i.test(str(row?.gearbox) ?? "")) return { selection: { ...sel, status: "OEM RFQ", flags: [SPECIAL_OEM] }, missing: [] };

  const missing: string[] = [];
  const noRow = i.mapKey ? `no MAPPING row for ${i.mapKey}` : "MAP KEY not derivable (needs a valve type, size and PN)";
  const freeOf = (code: unknown) => free.get(str(code) ?? "") ?? 0;
  // shortcut: each item checks free qty on its own, so two items of one docket can count the same free units; book them in Stock Allocation to hold them.
  const enough = (code: unknown) => freeOf(code) > 0 && freeOf(code) >= i.qty;
  const rate = (erp: string | null, sheet: number | null): Rate => {
    const r = erp ? rm.get(erp) : undefined;
    if (r != null) return { rate: r, rateSource: "RM", rateFlag: sheet != null && sheet > r ? RATE_FLAG : null };
    return { rate: sheet, rateSource: sheet == null ? null : "SHEET", rateFlag: null };
  };
  // Smallest rating that is big enough; on a tie the line with more free stock, then sheet order.
  const smallest = (rows: Row[], torque: (r: Row) => number | null, need: number) =>
    rows.filter((r) => (torque(r) ?? -1) >= need).sort((a, b) => torque(a)! - torque(b)! || freeOf(b.erpCode) - freeOf(a.erpCode))[0] ?? null;
  // A code typed by hand that is in neither master: a Raw Material ERP code is priced from the RM master, else pending.
  const typed = (code: string) => {
    const erp = isErpCode(code) ? code.trim().toUpperCase() : null;
    return { source: "stock" as const, model: code, erpCode: erp, torque: null, ...rate(erp, null) };
  };

  // Gearbox: Viral only (never AUMA GS). Worm for a BFV, the non-worm multi-turn types for other valves.
  const gbWanted = same(i.op, "ACT+GB") || !!i.gbCode;
  const worm = valveType === "BFV";
  const typeOk = (t: unknown) => (worm ? /worm/i.test(str(t) ?? "") : !!str(t) && !/worm/i.test(str(t)!));
  const stockGb = (g: Row): GbPick => {
    const v = m.viralGearboxes.find((x) => x.erpCode === g.erpCode);
    return {
      source: "stock", model: str(v?.model) ?? `${str(g.gbType)} ${num(g.ratedTorque)} Nm`, erpCode: str(g.erpCode), gbCode: str(v?.gbCode),
      torque: num(g.ratedTorque), ...rate(str(g.erpCode), num(v?.price)),
    };
  };
  const viralGb = (v: Row): GbPick => ({
    source: "viral", model: str(v.model), erpCode: str(v.erpCode), gbCode: str(v.gbCode), torque: num(v.maxOutputTorque), ...rate(str(v.erpCode), num(v.price)),
  });
  if (gbWanted) {
    if (i.gbCode) {
      const g = m.gearboxStock.find((x) => same(x.erpCode, i.gbCode!));
      const v = m.viralGearboxes.find((x) => same(x.gbCode, i.gbCode!) || same(x.erpCode, i.gbCode!));
      sel.gb = g ? stockGb(g) : v ? viralGb(v) : { ...typed(i.gbCode), gbCode: i.gbCode };
      sel.flags.push(HAND_GB);
    } else if (requiredTorque == null) missing.push(row ? `required torque blank in MAPPING for ${i.mapKey}` : noRow);
    else {
      const g = smallest(m.gearboxStock.filter((x) => isErpCode(str(x.erpCode)) && typeOk(x.gbType) && enough(x.erpCode)), (x) => num(x.ratedTorque), requiredTorque);
      const v = g ? null : smallest(m.viralGearboxes.filter((x) => typeOk(x.type)), (x) => num(x.maxOutputTorque), requiredTorque);
      sel.gb = g ? stockGb(g) : v && viralGb(v);
      if (!sel.gb) missing.push(`no ${worm ? "worm" : "multi-turn"} gearbox ≥ ${requiredTorque} Nm`);
    }
    if (sel.gb && sel.gb.rate == null) missing.push(`gearbox price (${sel.gb.model})`);
  }

  // Actuator: sized on the gearbox input torque with a gearbox, on the required torque without.
  const actNeed = gbWanted ? num(row?.actInputTorque) : requiredTorque;
  sel.actNeed = actNeed;
  const stockAct = (l: Row): ActPick => {
    const a = m.actuators.find((x) => x.actCode != null && x.actCode === l.actCode); // K-series line -> its model ("K150/RPM24" -> K150)
    return {
      source: "stock", make: str(l.make) ?? make, model: str(a?.model) ?? str(l.ratingCode)?.split("/")[0] ?? null, erpCode: str(l.erpCode),
      actCode: str(l.actCode), torque: num(l.torque), ...rate(str(l.erpCode), num(a?.price)),
    };
  };
  const newAct = (a: Row): ActPick => ({
    source: same(a.make, "AUMA") ? "auma" : "rotork", make: str(a.make)!, model: str(a.model), erpCode: null, actCode: str(a.actCode),
    torque: num(a.maxTorque), ...rate(null, num(a.price)),
  });
  if (i.actCode) {
    const l = m.actuatorStock.find((x) => same(x.erpCode, i.actCode!));
    const a = m.actuators.find((x) => same(x.actCode, i.actCode!));
    sel.act = l ? stockAct(l) : a ? newAct(a) : { ...typed(i.actCode), make, actCode: i.actCode };
    sel.flags.push(HAND_ACT);
  } else if (actNeed == null) missing.push(row ? `actuator torque blank in MAPPING for ${i.mapKey}` : noRow);
  else {
    // A stock line with a blank torque (AUMA SA nameplate not filled) is never proposed.
    const series = make === "AUMA" ? /^SA$/i : /^K-series/i;
    const l = smallest(m.actuatorStock.filter((x) => same(x.make, make) && enough(x.erpCode)), (x) => num(x.torque), actNeed);
    const a = l ? null : smallest(m.actuators.filter((x) => same(x.make, make) && series.test(str(x.series) ?? "")), (x) => num(x.maxTorque), actNeed);
    sel.act = l ? stockAct(l) : a && newAct(a);
    if (!sel.act) missing.push(`no ${make} ${make === "AUMA" ? "SA" : "K-series"} actuator ≥ ${actNeed} Nm`);
  }
  if (sel.act && sel.act.rate == null) missing.push(`actuator price (${sel.act.model})`);

  if (!i.actuatorItem) {
    const extra = (hand: number | null | undefined, estimate: number | null): Extra =>
      hand != null ? { amount: hand, estimated: false } : estimate != null ? { amount: estimate, estimated: true } : null;
    sel.adaptor = extra(i.adaptor, adaptorEstimate(sel.topFlange));
    sel.assembly = extra(i.assembly, assemblyEstimate(sel.dn));
    if (!sel.adaptor) missing.push(row ? `adaptor (no valve top flange for ${i.mapKey})` : noRow);
    if (!sel.assembly) missing.push(noRow);
  }
  for (const [label, p] of [["Actuator", sel.act], ["Gearbox", sel.gb]] as const) if (p?.rateFlag) sel.flags.push(`${label} ${p.model}: ${p.rateFlag}`);
  const why = [...new Set(missing)];
  sel.status = why.length ? "PENDING" : "OK";
  return { selection: sel, missing: why };
}

/**
 * Make / ACT CODE / GB CODE typed in the Actuator dialog. A typed value is kept until it is cleared (a make change re-picks
 * the codes); whatever the last pick wrote is picked again on every run. Items linked before the live sheet had MAPPING's
 * codes and the AUMA default auto-filled, so a stored master code with no pick yet is not a hand value either.
 */
export function handPicks(
  it: { actuatorMake?: string | null; actCode?: string | null; gbCode?: string | null; actuatorBreakdown?: unknown },
  patch: { actuatorMake?: string | null; actCode?: string | null; gbCode?: string | null },
  m: Master,
): { make: string | null; actCode: string | null; gbCode: string | null } {
  const last = (it.actuatorBreakdown as { selection?: Selection } | null | undefined)?.selection;
  const makeChanged = patch.actuatorMake !== undefined && patch.actuatorMake !== (it.actuatorMake ?? null);
  const keep = (typed: string | null | undefined, stored: string | null | undefined, auto: (c: string) => boolean) =>
    typed !== undefined && typed !== (stored ?? null) ? typed?.trim() || null : !stored || auto(stored) ? null : stored;
  return {
    make: keep(patch.actuatorMake, it.actuatorMake, (c) => !last || c === (last.aumaRequired ? "AUMA" : "Rotork")),
    actCode: keep(patch.actCode, it.actCode, (c) => makeChanged || (last
      ? !last.flags.includes(HAND_ACT) && c === (last.act?.actCode ?? last.act?.model)
      : m.actuators.some((a) => a.actCode === c))),
    gbCode: keep(patch.gbCode, it.gbCode, (c) => makeChanged || (last
      ? !last.flags.includes(HAND_GB) && c === last.gb?.gbCode
      : [...m.gearboxes, ...m.viralGearboxes].some((g) => g.gbCode === c))),
  };
}
