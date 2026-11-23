// Picks the actuator and gearbox of one docket item from the live master. Pure: no DB, no fetch (actuatorItem.ts reads).
// Puja's 20-Nov logic (SELECTION_LOGIC tab): every Viral gearbox that takes the torque (or none) with every Rotork K / AUMA SA
// model at its slowest standard speed that still gives the torque and turns the valve in time. Time first, then stock first,
// then the lowest total; Rotork on a tie. When nothing is in time: the fastest.
import type { Parsed } from "./actuatorMaster";
import { SPECIAL_OEM } from "./actuatorCost";
import { isErpCode } from "./actuatorStock";

export const RATE_FLAG = "rate increase – negotiate";
export const HAND_ACT = "actuator set by hand";
export const HAND_GB = "gearbox set by hand";
export const HAND_MAKE = "make set by hand";
export const RM_NEW = "RM code to be created";
export const TYPED_WEAK = "typed actuator below required torque – check";
export const SINGLE_PHASE = "single phase – select manually (AUMA, 60 s limit)";
export const OLD_WD = "old-stock actuator (old wiring diagram) – approval needed";
export const NO_TFW = "no imported (TFW) data for this size";
export const NO_TFW_FLANGE = "adaptor: the imported (TFW) data has no top flange for this size – type the adaptor amount in the Actuator dialog";
export const IMPORTED_FLAG = "Imported (TFW) data";

/** Makes a customer accepts, by party name (Puja, 17 Nov: "only AUMA is acceptable to Kalpataru"). The automatic pick stays inside them. */
// shortcut: typed here for one customer, move to a master (party -> accepted makes) when a second customer needs it.
export const CUSTOMER_MAKES: { party: RegExp; makes: string[] }[] = [{ party: /kalpataru/i, makes: ["AUMA"] }];
export const customerOnly = (makes: string[]) => `customer accepts ${makes.join(" / ")} only`;

/** The item text asks for a single-phase actuator (and does not name three phase too). */
export const isSinglePhase = (text: string) => /\b(?:single|1)[\s-]*ph(?:ase)?\b/i.test(text) && !/\b(?:three|3)[\s-]*ph(?:ase)?\b/i.test(text);

/** The assumptions of the 20-Nov logic, in one place. PN factor and safety factor stay in the sheet (MAPPING's required torque). */
export const ACT_RULES = {
  dnPerTurn: 6.35, // multi-turn valve turns = DN ÷ 6.35 (4 TPI), rounded as the sheet does, until GA stroke / pitch data exists
  timeLimit: 2, // minutes per stroke when the BOQ text gives none (target band 1.5–2.0)
  directMaxDn: 300, // sluice / RS / KGV: direct actuator up to DN300, Viral spur gearbox above
  // shortcut: Rotork K speeds typed here (sheet: "4.5–192"), torque drops from AUMA_ROTORK_ALT's notes; read the speed table of
  // GMD Technical Master Data › ACUATOR-MODEL NO (the app's Engineering Data › Actuator) once its rows are checked against these.
  rotorkRpm: [4.5, 6, 9, 12, 18, 24, 36, 48, 72, 96, 144, 192],
};

type Row = Record<string, string | number | null>;
export type Master = Pick<Parsed, "mappings" | "actuators" | "gearboxes" | "viralGearboxes" | "actuatorStock" | "gearboxStock"
  | "stockAutoPick" | "aumaSpeeds" | "rotorkDerates" | "rmCodes" | "imported">;

interface Rate { rate: number | null; rateSource: "RM" | "SHEET" | null; rateFlag: string | null }
export interface ActPick extends Rate {
  source: "stock" | "rotork" | "auma"; make: string; model: string | null; erpCode: string | null; actCode: string | null;
  torque: number | null; rpm: number | null; rmCode: string | null; // torque at that rpm; rmCode = the code the rate is looked up by
}
export interface GbPick extends Rate { source: "stock" | "viral"; model: string | null; erpCode: string | null; gbCode: string | null; torque: number | null; ratio: string | null }
type Extra = { amount: number; estimated: boolean } | null;

/** Stored as actuatorBreakdown.selection; the offer line and the OEM RFQ read it. Ones stored before 20 Nov have no rpm / ratio / time. */
export interface Selection {
  status: "OK" | "PENDING" | "OEM RFQ";
  mapKey: string | null; valveType: string | null; dn: number | null; pn: string | null; qty: number;
  requiredTorque: number | null; actNeed: number | null; topFlange: string | null;
  act: ActPick | null; gb: GbPick | null; adaptor: Extra; assembly: Extra;
  time: number | null; timeLimit: number; // operating time per stroke and the limit it was picked against, minutes
  aumaRequired: boolean; flags: string[];
}

export interface SelectInput {
  mapKey: string | null;
  actuatorItem: boolean; // Item type ACTUATOR: no valve part; adaptor / assembly as on a valve line (23 Nov), so not read here
  qty: number; // docket qty: a stock line needs this much free
  text: string; // item text (BOQ line): the make it names, single phase, an operating time
  party?: string | null; // the docket's party name: CUSTOMER_MAKES limits the makes
  make?: string | null; actCode?: string | null; gbCode?: string | null; // typed by hand, see handPicks
  adaptor?: number | null; assembly?: number | null; // typed by hand: win over the estimates
  // IMPORTED (Tianjin Tangfa "TFW" valve): torque with SF, turns and top flange come from m.imported, never from MAPPING.
  origin?: "INDIAN" | "IMPORTED";
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const same = (v: unknown, s: string) => str(v)?.toUpperCase() === s.toUpperCase();
const key = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase(); // "SA 12" = "SA12", "K 150" = "K150"
const EPS = 1e-9; // 286 Nm ÷ MA 2.6 is still the 110 Nm an SA 12 gives
// The last number found: a two-ratio spur box ("10:1 / 8:1", MA "8.8 / 7") runs on its second pair, as VALVE_ACT_SELECTION does.
const last = (v: unknown, re: RegExp) => {
  const xs = [...String(v ?? "").matchAll(re)];
  return xs.length ? Number(xs[xs.length - 1][1]) : null;
};

/** Adaptor plate + coupling per set, by the valve top flange (largest F size in the cell: "F07/F10" is F10). */
export function adaptorEstimate(flange: string | null): number | null {
  const f = Math.max(...[...(flange ?? "").matchAll(/F\s*(\d+)/gi)].map((x) => Number(x[1])));
  return !Number.isFinite(f) ? null : f <= 10 ? 1500 : f <= 14 ? 2500 : f <= 16 ? 3500 : f <= 25 ? 6000 : 10000;
}

/** Assembly & testing per valve, by DN. */
export const assemblyEstimate = (dn: number | null): number | null =>
  dn && dn > 0 ? (dn <= 300 ? 1500 : dn <= 600 ? 3000 : dn <= 1000 ? 5000 : 8000) : null;

/** Operating time the BOQ text asks for ("operating time 60 sec", "closing time 1.5 min", "90 to 120 s"), in minutes; null if none. */
export function specTime(text: string): number | null {
  const m = /\b(?:operating|opening|closing|stroke)\s+time\D{0,15}?(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(sec|s\b|min)/i.exec(text);
  return m ? Number(m[2] ?? m[1]) / (/^s/i.test(m[3]) ? 60 : 1) : null;
}

interface GbOpt { pick: GbPick | null; ratio: number | null; ma: number | null } // pick null = direct drive
interface ActOpt { pick: ActPick; curve: { rpm: number; torque: number }[] } // max torque per standard speed
interface Combo { gb: GbOpt; act: ActOpt; rpm: number; torque: number; tIn: number; time: number; ok: boolean; total: number; stock: number }

/**
 * `missing` lists what keeps the actuator side from a price (empty = status OK). `free` = free qty per ERP code
 * (live stock minus allocations), `rm` = Raw Material master rate per ERP code.
 */
export function selectActuator(i: SelectInput, m: Master, free: Map<string, number>, rm: Map<string, number>): { selection: Selection; missing: string[] } {
  const [type = null, dn = null, pn = null] = i.mapKey?.split("|") ?? [];
  // Imported: SLUICE / SLUICE-RS read the TFW gate rows, BFV the TFW butterfly rows; any other type has no TFW data.
  // `row` (MAPPING) stays undefined, so nothing below can take an Indian torque, flange or "refer OEM" for an imported valve.
  const imported = i.origin === "IMPORTED";
  const impType = !imported ? null : /^SLUICE/.test(type ?? "") ? "SLUICE-IMP" : /^BFV/.test(type ?? "") ? "BFV-IMP" : null;
  const imp = impType ? m.imported.find((r) => r.mapKey === `${impType}|${dn}|${pn}`) : undefined;
  const valveType = imported ? impType ?? type : type;
  const row = imported ? undefined : m.mappings.find((r) => r.mapKey === i.mapKey);
  // No approved-make list is recorded: a BOQ text naming one make only gets that make; naming both or neither, the cheaper.
  const named = ["Rotork", "AUMA"].filter((mk) => new RegExp(`\\b${mk}\\b`, "i").test(i.text));
  const handMake = ["Rotork", "AUMA"].find((mk) => same(i.make, mk));
  // A customer's accepted makes win over the text (it may name Rotork or both); only a make / actuator typed by hand goes outside them.
  const accepted = CUSTOMER_MAKES.find((c) => c.party.test(i.party ?? ""))?.makes;
  const allowed = accepted ?? ["Rotork", "AUMA"];
  const makes = handMake ? [handMake] : named.length === 1 && allowed.includes(named[0]) ? named : allowed;
  const wanted = accepted ?? named; // also decides which OEM a refer-OEM enquiry goes to
  const noMake = `no ${makes.join(" / ")} actuator for`, onlyNote = accepted && !handMake ? ` (${customerOnly(accepted)})` : "";
  const requiredTorque = imp ? imp.requiredTorque : num(row?.requiredTorque);
  const timeLimit = specTime(i.text) ?? ACT_RULES.timeLimit;
  const sel: Selection = {
    status: "PENDING", mapKey: i.mapKey, valveType, dn: dn ? Number(dn) : null, pn, qty: i.qty, requiredTorque, actNeed: null,
    topFlange: imp ? imp.valveFlange : str(row?.valveFlange), act: null, gb: null, adaptor: null, assembly: null, time: null, timeLimit,
    aumaRequired: wanted.length === 1 && wanted[0] === "AUMA", flags: [...(imported ? [IMPORTED_FLAG] : []), ...(handMake ? [HAND_MAKE] : [])],
  };
  if (/special/i.test(str(row?.gearbox) ?? "")) return { selection: { ...sel, status: "OEM RFQ", flags: [SPECIAL_OEM] }, missing: [] };

  const missing: string[] = [];
  // Imported, row found: the only thing that can still lack a row's data is the adaptor (no TFW top flange, ruling D1).
  const noRow = !i.mapKey ? "MAP KEY not derivable (needs a valve type, size and PN)"
    : imported ? (imp ? NO_TFW_FLANGE : NO_TFW) : `no MAPPING row for ${i.mapKey}`;
  const freeOf = (code: unknown) => free.get(str(code) ?? "") ?? 0;
  // shortcut: each item checks free qty on its own, so two items of one docket can count the same free units; book them in Stock Allocation to hold them.
  const enough = (code: unknown) => freeOf(code) > 0 && freeOf(code) >= i.qty;
  const rate = (erp: string | null, sheet: number | null): Rate => {
    const r = erp ? rm.get(erp) : undefined;
    if (r != null) return { rate: r, rateSource: "RM", rateFlag: sheet != null && sheet > r ? RATE_FLAG : null };
    return { rate: sheet, rateSource: sheet == null ? null : "SHEET", rateFlag: null };
  };
  const erpOf = (code: string) => (isErpCode(code) ? code.trim().toUpperCase() : null);

  // Gearbox: BFV always a Viral worm box; sluice / RS / KGV direct up to DN300, a Viral spur box above. A typed GB CODE wins.
  const worm = valveType === "BFV" || valveType === "BFV-IMP";
  const needGb = worm || Number(dn) > ACT_RULES.directMaxDn;
  const typeOk = (t: unknown) => (worm ? /worm/i.test(str(t) ?? "") : !!str(t) && !/worm/i.test(str(t)!));
  const viral = (v: Row): GbOpt => {
    const erp = str(v.erpCode), ratio = last(v.ratio, /(\d+(?:\.\d+)?)\s*:\s*1/g), ma = last(v.ma, /(\d+(?:\.\d+)?)/g);
    return { ratio, ma, pick: {
      source: enough(erp) ? "stock" : "viral", model: str(v.model), erpCode: erp, gbCode: str(v.gbCode), torque: num(v.maxOutputTorque),
      ratio: ratio ? `${ratio}:1` : null, ...rate(erp, num(v.price)),
    } };
  };
  let gbs: GbOpt[] = [];
  if (i.gbCode) {
    const v = m.viralGearboxes.find((x) => same(x.gbCode, i.gbCode!) || same(x.erpCode, i.gbCode!));
    const g = m.gearboxStock.find((x) => same(x.erpCode, i.gbCode!));
    const erp = str(g?.erpCode) ?? erpOf(i.gbCode);
    // A box with no MA / ratio (old stock line, a Raw Material code) is priced, but the actuator then has to be typed too.
    gbs = [v ? viral(v) : { ratio: null, ma: null, pick: {
      source: "stock", model: g ? `${str(g.gbType)} ${num(g.ratedTorque)} Nm` : i.gbCode, erpCode: erp, gbCode: g ? null : i.gbCode,
      torque: num(g?.ratedTorque), ratio: null, ...rate(erp, null),
    } }];
    sel.flags.push(HAND_GB);
  } else if (requiredTorque != null) {
    gbs = needGb ? m.viralGearboxes.filter((v) => typeOk(v.type) && (num(v.maxOutputTorque) ?? -1) >= requiredTorque).map(viral) : [{ pick: null, ratio: 1, ma: 1 }];
  }

  // Actuators: Rotork K and AUMA SA (3-phase table) at the master price, plus stock lines marked auto-pick ON.
  const curve = (a: Row) => same(a.make, "AUMA")
    ? m.aumaSpeeds.filter((s) => /3-ph/i.test(s.phase) && key(s.model) === key(a.model)).map(({ rpm, torque }) => ({ rpm, torque }))
    : /^K-series/i.test(str(a.series) ?? "")
      ? ACT_RULES.rotorkRpm.map((rpm) => ({ rpm, torque: Math.min(num(a.maxTorque) ?? 0, ...m.rotorkDerates.filter((d) => key(d.model) === key(a.model) && d.rpm === rpm).map((d) => d.torque)) }))
      : [];
  const masterAct = (a: Row): ActOpt => {
    const code = m.rmCodes.find((c) => same(a.make, c.make) && key(c.model) === key(a.model))?.code ?? null; // generic model code
    return { curve: curve(a), pick: {
      source: same(a.make, "AUMA") ? "auma" : "rotork", make: str(a.make)!, model: str(a.model), erpCode: null, actCode: str(a.actCode),
      torque: num(a.maxTorque), rpm: null, rmCode: code, ...rate(code, num(a.price)),
    } };
  };
  const stockAct = (l: Row): ActOpt => {
    const a = m.actuators.find((x) => x.actCode != null && x.actCode === l.actCode); // K-series line -> its model ("K150/RPM24" -> K150)
    const erp = str(l.erpCode), rpm = num(l.outputRpm), torque = num(l.torque);
    return { curve: rpm != null && torque != null ? [{ rpm, torque }] : [], pick: {
      source: "stock", make: str(l.make) ?? makes[0], model: str(a?.model) ?? str(l.ratingCode)?.split("/")[0] ?? null, erpCode: erp,
      actCode: str(l.actCode), torque, rpm, rmCode: erp, ...rate(erp, num(a?.price)),
    } };
  };
  const ofMake = (r: Row) => makes.some((mk) => same(r.make, mk));
  const autos = [
    ...m.actuatorStock.filter((l) => ofMake(l) && m.stockAutoPick.includes(str(l.erpCode) ?? "") && enough(l.erpCode)).map(stockAct),
    ...m.actuators.filter(ofMake).map(masterAct),
  ];
  let hand: ActOpt | null = null;
  if (i.actCode) {
    const l = m.actuatorStock.find((x) => same(x.erpCode, i.actCode!));
    const a = m.actuators.find((x) => same(x.actCode, i.actCode!));
    const erp = erpOf(i.actCode);
    // An unknown code's make never comes from the customer's list: it would be labelled AUMA and escape the flag below.
    hand = l ? stockAct(l) : a ? masterAct(a) : { curve: [], pick: {
      source: "stock", make: handMake ?? (named.length === 1 ? named[0] : "Rotork"), model: i.actCode, erpCode: erp, actCode: i.actCode, torque: null, rpm: null, rmCode: erp, ...rate(erp, null),
    } };
    sel.flags.push(HAND_ACT);
    // Stock actuators have old wiring diagrams, not interchangeable (23 Nov): a typed one is only flagged, its rate is untouched.
    // A code that looks like an ERP code but is in neither STOCK_ACT nor the masters (nor a generic model code) is treated the same.
    if (l ? !m.stockAutoPick.includes(str(l.erpCode) ?? "") : !a && erp && !m.rmCodes.some((c) => same(c.code, erp))) sel.flags.push(OLD_WD);
  }

  const combos = (acts: ActOpt[]): Combo[] => requiredTorque == null ? [] : gbs.flatMap((g) => {
    if (!g.ratio || !g.ma) return [];
    const tIn = requiredTorque / g.ma, turns = (worm ? 0.25 : imp?.turns ?? Math.round(Number(dn) / ACT_RULES.dnPerTurn)) * g.ratio;
    const inTime = (rpm: number) => rpm * timeLimit >= turns - EPS;
    return acts.flatMap((a) => {
      const fit = a.curve.filter((p) => p.torque >= tIn - EPS).sort((x, y) => x.rpm - y.rpm);
      const p = fit.find((x) => inTime(x.rpm)) ?? fit[fit.length - 1]; // the slowest speed in time, else the fastest
      return p ? [{
        gb: g, act: a, rpm: p.rpm, torque: p.torque, tIn, time: turns / p.rpm, ok: inTime(p.rpm),
        total: (a.pick.rate ?? Infinity) + (g.pick ? g.pick.rate ?? Infinity : 0), stock: +(a.pick.source === "stock") + +(g.pick?.source === "stock"),
      }] : [];
    });
  });
  const rotorkFirst = (c: Combo) => +(c.act.pick.make !== "Rotork");
  // In time: stock first, the lowest total, Rotork on a tie, then the slower (nearer the limit). None in time: the fastest.
  const best = (cs: Combo[]) => {
    const ok = cs.filter((c) => c.ok);
    return ok.length
      ? ok.sort((a, b) => b.stock - a.stock || a.total - b.total || rotorkFirst(a) - rotorkFirst(b) || b.time - a.time)[0]
      : cs.sort((a, b) => a.time - b.time || a.total - b.total || rotorkFirst(a) - rotorkFirst(b))[0];
  };
  // Single phase (AUMA only, 60 s per stroke) is not in these tables: nothing is auto-picked.
  const singlePhase = isSinglePhase(i.text);
  // A typed actuator gets the gearbox that suits it; one with no speed data, the gearbox the auto pick takes.
  const c = singlePhase ? undefined : best(combos(hand ? [hand] : autos)) ?? (hand ? best(combos(autos)) : undefined);
  const own = !!c && (!hand || c.act === hand);
  // A typed actuator with a torque curve that no gearbox / speed lets take the torque stays as typed, but is not priced silently.
  if (hand?.curve.length && requiredTorque != null && !singlePhase && !own) sel.flags.push(TYPED_WEAK);
  sel.gb = i.gbCode ? gbs[0].pick : c?.gb.pick ?? null;
  sel.act = c && own ? { ...c.act.pick, rpm: c.rpm, torque: c.torque } : hand?.pick ?? null;
  if (c && own) {
    sel.actNeed = Math.round(c.tIn);
    sel.time = Math.round(c.time * 100) / 100;
    if (!c.ok) sel.flags.push(`Over ${timeLimit} min`);
  }
  // Typed by hand outside what the customer accepts: kept, but never silently.
  const got = sel.act?.make ?? handMake;
  if (accepted && got && !accepted.some((mk) => same(got, mk))) sel.flags.push(customerOnly(accepted));

  if (requiredTorque == null) missing.push(row ? `required torque blank in MAPPING for ${i.mapKey}` : noRow);
  else if (singlePhase && (!sel.act || (needGb && !sel.gb))) missing.push(SINGLE_PHASE);
  else if (needGb && !sel.gb) missing.push(gbs.length ? `${noMake} ${requiredTorque} Nm${onlyNote}` :`no ${worm ? "worm" : "spur"} gearbox ≥ ${requiredTorque} Nm`);
  else if (!sel.act) missing.push(sel.gb && !gbs[0].ratio ? `actuator: gearbox ${sel.gb.model} has no MA / ratio in GB_MASTER, set it by hand` : `${noMake} ${requiredTorque} Nm${onlyNote}`);
  if (sel.gb && sel.gb.rate == null) missing.push(`gearbox price (${sel.gb.model})`);
  if (sel.act && sel.act.rate == null) missing.push(`actuator price (${sel.act.model})`);
  // The sheet's price stands until the code exists (20-Nov mail: SA 50 / 60 / 100, K 1000, VWE-07, VWESGA-40, SGB-3000 / 5000).
  if (sel.act && sel.act.source !== "stock" && sel.act.rateSource !== "RM") sel.flags.push(`${RM_NEW}: ${sel.act.make} ${sel.act.model}`);
  if (sel.gb?.source === "viral" && sel.gb.rateSource !== "RM") sel.flags.push(`${RM_NEW}: Viral ${sel.gb.model}`);

  // Item type ACTUATOR lines carry adaptor and assembly too, exactly like a valve line (Puja, 23 Nov).
  const extra = (hand: number | null | undefined, estimate: number | null): Extra =>
    hand != null ? { amount: hand, estimated: false } : estimate != null ? { amount: estimate, estimated: true } : null;
  sel.adaptor = extra(i.adaptor, adaptorEstimate(sel.topFlange));
  sel.assembly = extra(i.assembly, assemblyEstimate(sel.dn));
  if (!sel.adaptor) missing.push(row ? `adaptor (no valve top flange for ${i.mapKey})` : noRow);
  if (!sel.assembly) missing.push(noRow);
  for (const [label, p] of [["Actuator", sel.act], ["Gearbox", sel.gb]] as const) if (p?.rateFlag) sel.flags.push(`${label} ${p.model}: ${p.rateFlag}`);
  const why = [...new Set(missing)];
  sel.status = why.length ? "PENDING" : "OK";
  return { selection: sel, missing: why };
}

/** Every code to look up in the RM master and the stock: stock / Viral ERP codes, the generic model codes, codes typed by hand. */
export function rmLookupCodes(m: Master, typed: (string | null | undefined)[]): string[] {
  const codes = [...m.actuatorStock, ...m.gearboxStock, ...m.viralGearboxes].map((r) => String(r.erpCode ?? ""))
    .concat(m.rmCodes.map((c) => c.code ?? ""), typed.map((c) => (c ?? "").trim().toUpperCase()));
  return [...new Set(codes.filter(isErpCode))];
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
    // The pick writes the make it chose, marking a typed one; a selection stored before 20 Nov (no time) wrote the old default.
    make: keep(patch.actuatorMake, it.actuatorMake, (c) => !last || (last.time !== undefined ? !last.flags.includes(HAND_MAKE) : c === (last.aumaRequired ? "AUMA" : "Rotork"))),
    actCode: keep(patch.actCode, it.actCode, (c) => makeChanged || (last
      ? !last.flags.includes(HAND_ACT) && c === (last.act?.actCode ?? last.act?.model)
      : m.actuators.some((a) => a.actCode === c))),
    gbCode: keep(patch.gbCode, it.gbCode, (c) => makeChanged || (last
      ? !last.flags.includes(HAND_GB) && c === last.gb?.gbCode
      : [...m.gearboxes, ...m.viralGearboxes].some((g) => g.gbCode === c))),
  };
}

/** The item's origin after a save: only "IMPORTED" is stored; anything else (also a bad value from the client) is blank = Indian. */
export const originAfter = (stored: string | null | undefined, patch: { valveOrigin?: string | null }): "IMPORTED" | null =>
  String((patch.valveOrigin !== undefined ? patch.valveOrigin : stored) ?? "").trim().toUpperCase() === "IMPORTED" ? "IMPORTED" : null;

/**
 * An origin change means another valve's torque and turns, like a MAP KEY change: codes typed for the old origin are dropped
 * (the dialog re-sends them unchanged); a code typed in the same save is kept.
 */
export function patchForOrigin<P extends { valveOrigin?: string | null; actCode?: string | null; gbCode?: string | null }>(
  it: { valveOrigin?: string | null; actCode?: string | null; gbCode?: string | null }, patch: P,
): P {
  if (originAfter(it.valveOrigin, patch) === originAfter(it.valveOrigin, {})) return patch;
  const fresh = (typed: string | null | undefined, stored: string | null | undefined) => (typed !== undefined && typed !== (stored ?? null) ? typed : null);
  return { ...patch, actCode: fresh(patch.actCode, it.actCode), gbCode: fresh(patch.gbCode, it.gbCode) };
}
