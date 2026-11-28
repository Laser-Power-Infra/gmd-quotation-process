import { parseGmdDate } from "@gmd/ui/lib/dateParse";
import { ACTUATOR, parseLine, parseStock, type ParsedLine, type ParsedStock } from "./parse";
import type {
  Allocation, AllocationInputs, AllocationResult, Basis, ContractLine, LedgerEntry, LineAllocation, OfferLine, PurchaseSource, Stage, StockItem,
} from "./types";

export { parseLine, parseStock };

const ACT_FLAG = "actuator held from stock";
const CS_FLAG = "CS offered against DI";
const WIRING_FLAG = "allocated - wiring change required";
const SLV = "SLUICE VALVE";
const bad = (s: string | null | undefined) => { const t = (s ?? "").trim(); return !t || t === "#N/A"; };
const code = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Queue among lines of one MC status: Kalpataru UP (0), then Kalpataru MP / MGMR (1), then the rest (2).
 * Puja has not yet said how to tell UP from MP: party + Contract Review STATE until she does. Change it here only.
 */
function priorityTier(l: ContractLine): number {
  if (!/KALPATARU/i.test(l.party)) return 2;
  const st = code(l.state);
  return st === "UTTAR PRADESH" || st === "UP" ? 0 : st === "MADHYA PRADESH" || st === "MP" ? 1 : 2;
}
/** Blue Star is left out for now (18 Nov). */
const blueStar = (l: ContractLine) => /BLUE\s*STAR/i.test(l.party);

/** null = no match; else a sort rank (lower first) and flags. `anyDrill` skips the drilling check (machining suggestions). */
function match(need: string, l: ParsedLine, s: ParsedStock, anyDrill = false): { rank: number; flags: string[] } | null {
  if (need === ACTUATOR) {
    if (s.act === null || l.act === null) return null;
    if (s.act === l.act) return { rank: 0, flags: [] };
    // another actuator only of the same model and RPM, and then with a wiring change
    return l.actModel !== null && s.actModel === l.actModel ? { rank: 10, flags: [WIRING_FLAG] } : null;
  }
  if (s.vt !== need || s.size !== l.size || (s.metal !== null && s.metal !== l.metal) || s.wafer !== l.wafer) return null;
  if (!anyDrill && s.drill !== l.drill) return null; // IS 9523 and IS 1538 drilling differ: never across standards
  const flags: string[] = [];
  let rank = 0;
  if (s.mat !== l.mat) {
    if (!(need === SLV && l.mat === "DI" && s.mat === "CS")) return null;
    flags.push(CS_FLAG); rank += 10;
  }
  if (need === SLV && s.rising !== l.rising) return null;
  if (l.pn && s.pn) {
    if (l.pn.cls || s.pn.cls) { if (l.pn.cls !== s.pn.cls || l.pn.n !== s.pn.n) return null; }
    else if (l.pn.n <= 16) {
      if (s.pn.n === 25) { if (l.size > 80) return null; rank += 5; flags.push(`PN-25 offered against PN-${l.pn.n}`); }
      else if (s.pn.n !== 16 && s.pn.n !== 10) return null;
    } else if (s.pn.n !== 25) return null;
  }
  return { rank, flags };
}

export function allocateStock(input: { stock: StockItem[]; lines: ContractLine[]; ledger: LedgerEntry[] } & AllocationInputs): AllocationResult {
  const stock = input.stock.filter((s) => !bad(s.erpCode) && s.availableQty > 0);
  const ps = new Map(stock.map((s) => [s.id, parseStock(s)]));
  const free = new Map(stock.map((s) => [s.id, s.availableQty]));
  // indexes, in stock order: finished rows by part (valves by type + size, actuators all together; match() checks
  // the rest) and every row by code
  const group = (m: Map<string, StockItem[]>, k: string, s: StockItem) => { const b = m.get(k); if (b) b.push(s); else m.set(k, [s]); };
  const pools = new Map<string, StockItem[]>(), byCode = new Map<string, StockItem[]>();
  for (const s of stock) {
    const sp = ps.get(s.id)!;
    if (sp.kind) group(pools, sp.vt === ACTUATOR ? ACTUATOR : `${sp.vt}|${sp.size}`, s);
    group(byCode, code(s.erpCode), s);
  }
  const pool = (need: string, p: ParsedLine) => pools.get(need === ACTUATOR ? ACTUATOR : `${need}|${p.size}`) ?? [];
  const rowsOf = (c: string) => byCode.get(c) ?? [];
  const freeOf = (rows: StockItem[]) => rows.reduce((a, s) => a + free.get(s.id)!, 0);
  const live = input.lines.filter((l) => l.balanceQty > 0);
  const pl = new Map(live.map((l) => [l.id, parseLine(l)]));
  const allocations: Allocation[] = [];
  // per line: complete-valve qty got per part (valve type or ACTUATOR); a line with several parts needs all of them
  const got = new Map<string, Map<string, number>>(live.map((l) => [l.id, new Map()]));
  const stageOf = (l: ContractLine): Stage => l.inspection === "DONE" ? "Inspection done" : l.offer === "DONE" ? "Offered" : "Booked";

  // Qty offered but not billed holds its stock first (onb); then the balance to offer (bto): MC qty − offered,
  // or the whole balance for an MC-pending line. With no offered qty from the host (or 0 while Contract Review says
  // DONE: the MC register can lag), DONE means wholly offered, as before.
  const split = new Map(live.map((l) => {
    const done = l.inspection === "DONE" || l.offer === "DONE";
    let offered = input.offered?.[l.id];
    // no register reading (or 0 while DONE): the MC qty is what DONE means, once the host passes offered qty at all
    if (input.offered && (offered === undefined || (!offered && done)) && l.mcQty != null && !l.mcPending) offered = done ? l.mcQty : 0;
    if (offered === undefined || (!offered && done)) {
      const onb = done ? l.balanceQty : 0;
      return [l.id, { onb, bto: l.balanceQty - onb }];
    }
    const onb = clamp(offered - (l.billedQty ?? 0), 0, l.balanceQty), rest = l.balanceQty - onb;
    return [l.id, { onb, bto: l.mcPending || l.mcQty == null ? rest : clamp(l.mcQty - offered, 0, rest) }];
  }));
  const q = (l: ContractLine) => split.get(l.id)!;
  const partsOf = new Map<string, Map<string, number>>(); // per line: parts held (RM route or a lock), by code

  const add = (l: ContractLine, s: StockItem, qty: number, a: Partial<Allocation> & { flags: string[] }) => {
    const p = ps.get(s.id)!, acted = pl.get(l.id)!.actuated, spare = a.spare ?? !p.kind, flags = [...a.flags];
    free.set(s.id, free.get(s.id)! - qty);
    if (!spare) { // only a finished valve or actuator makes up a line; a part just holds its stock
      const g = got.get(l.id)!; g.set(p.vt, (g.get(p.vt) ?? 0) + qty);
      // same spec under another FG code: used as it is (no M2M or reversal), booked across by a production entry
      if (p.vt !== ACTUATOR && code(s.erpCode) !== code(l.itemCode)) flags.push(`production entry from ${s.erpCode}`);
    } else {
      const m = partsOf.get(l.id) ?? new Map<string, number>();
      m.set(code(s.erpCode), (m.get(code(s.erpCode)) ?? 0) + qty); partsOf.set(l.id, m);
    }
    // only the actuator's own row says so: a locked valve with no actuator free must not claim one
    if (p.vt === ACTUATOR) flags.push(ACT_FLAG);
    allocations.push({
      stockId: s.id, erpCode: s.erpCode, location: s.location, contractNo: l.contractNo, itemCode: l.itemCode,
      party: l.party, poNo: l.poNo, qty, stage: stageOf(l), basis: acted ? "Actuator to map" : "Finished",
      source: "auto", ledgerId: null, allocatedAt: null, ...a, spare, flags,
    });
  };

  /** Hold up to `qty` of `rows` for a line, as a booking does; returns what was held. */
  const reserve = (l: ContractLine, rows: StockItem[], qty: number, a: { source: Allocation["source"]; ledgerId: string | null; allocatedAt: string | null; basis?: Basis }) => {
    let left = qty;
    for (const s of rows) {
      const n = Math.min(left, free.get(s.id)!);
      if (n <= 0) continue;
      // a booking or lock keeps what matching would say (wiring change, PN-25, CS for DI)
      const sp = ps.get(s.id)!, m = sp.kind ? match(sp.vt, pl.get(l.id)!, sp) : null;
      add(l, s, n, { ...a, flags: m?.flags ?? [] });
      left -= n;
    }
    return qty - left;
  };

  // 1. ledger, oldest first
  const ledger = [...input.ledger].sort((a, b) => a.allocatedAt.localeCompare(b.allocatedAt));
  for (const e of ledger) {
    const ec = code(e.erpCode);
    const rows = rowsOf(ec).filter((s) => !e.location || s.location === e.location);
    const l = live.find((x) => x.contractNo === e.contractNo && x.itemCode === e.itemCode);
    if (!l) { // closed or missing line: history only, takes no stock
      allocations.push({
        stockId: rows[0]?.id ?? "", erpCode: ec, location: e.location, contractNo: e.contractNo, itemCode: e.itemCode,
        party: input.lines.find((x) => x.contractNo === e.contractNo)?.party ?? "", poNo: null, qty: e.qty,
        stage: "Dispatched", basis: e.basis ?? "Finished", source: e.source, ledgerId: e.id, spare: false,
        flags: [], allocatedAt: e.allocatedAt,
      });
      continue;
    }
    reserve(l, rows, e.qty, { source: e.source, ledgerId: e.id, allocatedAt: e.allocatedAt, ...(e.basis ? { basis: e.basis } : {}) });
  }
  // Purchase allocations: the received part is held like a manual booking, on the purchase line's own item code.
  const extraFlags = new Map<string, string[]>(); // per line id; kept off offerNow, which feeds Ready to Bill
  const purchase = [...(input.purchaseAllocations ?? [])]
    .sort((a, b) => (a.allocatedAt ?? "").localeCompare(b.allocatedAt ?? "") || (a.id ?? "").localeCompare(b.id ?? ""))
    .flatMap((p) => {
    const l = live.find((x) => x.contractNo === p.contractNo && x.itemCode === p.itemCode);
    return l ? [{ p, l }] : [];
  });
  for (const { p, l } of purchase) {
    const flags = extraFlags.get(l.id) ?? [];
    if (p.physicalQty > 0 && reserve(l, rowsOf(code(p.erpCode)), p.physicalQty, { source: "manual", ledgerId: null, allocatedAt: null }) < p.physicalQty) {
      flags.push("Received - not yet in stock");
    }
    if (p.shortQty > 0) flags.push(`Short receipt ${p.shortQty}`);
    extraFlags.set(l.id, flags);
  }

  /** Complete valves held (finished stock), whatever they were held for. */
  const held = (l: ContractLine) => {
    const g = got.get(l.id)!, n = pl.get(l.id)!.needs;
    // an actuator is never a valve on its own (a line with no stocked valve type holds RM-route actuators)
    return n.length > 1 ? Math.min(...n.map((k) => g.get(k) ?? 0)) : [...g].reduce((a, [k, v]) => (n.length || k !== ACTUATOR ? a + v : a), 0);
  };
  const bomOf = (l: ContractLine) => {
    const per = new Map<string, number>();
    for (const x of input.boms?.[l.id] ?? []) if (x.qty > 0) per.set(code(x.erpCode), (per.get(code(x.erpCode)) ?? 0) + x.qty);
    return per;
  };
  /** Valves the line can build from parts it already holds (a lock): they count as had, so finished stock is not taken on top. */
  const built = (l: ContractLine) => {
    const per = bomOf(l);
    return per.size ? Math.min(...[...per].map(([c, k]) => Math.floor((partsOf.get(l.id)?.get(c) ?? 0) / k))) : 0;
  };

  /**
   * Finished stock for one part of a line, up to `cap`, best first: the line's own code, then the same spec under another
   * code. `commit` = hold it (else just count); `booked` = beyond the qty already offered, so it reads Booked.
   */
  // shortcut: a kit row (e.g. TPAV + isolation SLV under one FG code) is never split into its parts; needs the kit BOM (phase 2).
  const take = (l: ContractLine, need: string, cap: number, commit: boolean, booked = false) => {
    if (cap <= 0) return 0;
    const p = pl.get(l.id)!;
    const c = pool(need, p).flatMap((s) => {
      const m = match(need, p, ps.get(s.id)!);
      return m ? [{ s, flags: m.flags, key: [code(s.erpCode) === code(l.itemCode) ? 0 : 1, m.rank] }] : [];
    }).sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
    let left = cap;
    for (const { s, flags } of c) {
      const n = Math.min(left, free.get(s.id)!);
      if (n <= 0) continue;
      if (commit) add(l, s, n, booked ? { flags, stage: "Booked" } : { flags });
      left -= n;
    }
    return cap - left;
  };

  /** Lines in turn take finished stock up to `target` complete valves. */
  const fill = (order: ContractLine[], target: (l: ContractLine) => number, booked: boolean, own = false) => {
    for (const l of order) {
      const p = pl.get(l.id)!;
      if (!p.needs.length) continue;
      // valves built from held parts count as had, with the actuators held for them
      const g = got.get(l.id)!, b = own ? built(l) : 0, ba = Math.min(b, Math.max(0, (g.get(ACTUATOR) ?? 0) - held(l)));
      const have = (n: string) => (g.get(n) ?? 0) - (n === ACTUATOR ? ba : 0), want = target(l) - b;
      // Every part is filled to the same reach: a part the ledger already holds (a locked valve) gets the
      // others on top, and a line missing one part (no matching actuator) takes nothing, leaving the rest free.
      const reach = Math.min(...p.needs.map((n) => have(n) + take(l, n, want - have(n), false)));
      for (const n of p.needs) if (reach > have(n)) take(l, n, reach - have(n), true, booked);
    }
  };

  // 2-4. lines by priority: tier, MC date, then contract date; the same dates (or both undated: Infinity - Infinity
  // = NaN) fall back to id, so DB row order never decides
  const byTier = (a: ContractLine, b: ContractLine) => {
    const x = pl.get(a.id)!, y = pl.get(b.id)!;
    return priorityTier(a) - priorityTier(b) || x.mcTime - y.mcTime || x.time - y.time || a.id.localeCompare(b.id);
  };
  const sorted = (f: (l: ContractLine) => boolean) => live.filter(f).sort(byTier);
  const received = sorted((l) => !l.mcPending && !blueStar(l));
  const order = [...received, ...sorted((l) => !!l.mcPending && !blueStar(l))];
  // stock offered, inspected or under DI is taken already: inspected first, then offered (Blue Star too)
  fill([
    ...sorted((l) => l.inspection === "DONE"),
    ...sorted((l) => l.inspection !== "DONE" && l.offer === "DONE"),
    ...sorted((l) => l.inspection !== "DONE" && l.offer !== "DONE"),
  ], (l) => q(l).onb, false);
  fill(received, (l) => q(l).onb + q(l).bto, true, true);
  fill(order, (l) => l.balanceQty, true, true); // MC-pending lines, after any qty an MC-received line still awaits an MC for
  const fgOf = (l: ContractLine) => clamp(held(l) - q(l).onb, 0, q(l).bto);

  // RM route: valves buildable from the line's major BOM parts out of what finished stock left, counting the parts the
  // line holds already (a lock). An actuated line builds only as many as it gets approved actuators for, held with
  // the parts. Exact codes, so STD and IS 9523 parts never pool.
  const rmOf = new Map<string, number>();
  for (const l of order) {
    const per = bomOf(l);
    const short =q(l).bto - fgOf(l);
    if (!per.size || short <= 0) continue;
    const p = pl.get(l.id)!, own = (c: string) => partsOf.get(l.id)?.get(c) ?? 0;
    // actuators held beyond the line's complete valves, then the approved ones still free
    const extra = p.actuated ? Math.max(0, (got.get(l.id)!.get(ACTUATOR) ?? 0) - held(l)) : 0;
    const acts = p.actuated ? extra + take(l, ACTUATOR, short - extra, false) : short;
    const n = Math.min(short, acts, ...[...per].map(([c, k]) => Math.floor((freeOf(rowsOf(c)) + own(c)) / k)));
    if (n <= 0) continue;
    rmOf.set(l.id, n);
    if (p.actuated) take(l, ACTUATOR, n - extra, true, true);
    for (const [c, k] of per) {
      let left = n * k - own(c);
      for (const s of rowsOf(c)) {
        const t = Math.min(left, free.get(s.id)!);
        if (t <= 0) continue;
        add(l, s, t, { flags: [], basis: "Assemble", spare: true, stage: "Booked" });
        left -= t;
      }
    }
  }
  const rm = (l: ContractLine) => rmOf.get(l.id) ?? 0;

  // Incoming (China shipments): after physical stock, earliest ETA first, only what is still short; never physical.
  const ships = (input.incoming ?? [])
    .map((r) => ({ ...r, left: r.qty, t: parseGmdDate(r.eta)?.getTime() ?? Infinity }))
    .sort((a, b) => a.t - b.t);
  const inc = new Map<string, { qty: number; eta: string | null }>();
  for (const l of order) {
    let short = q(l).bto - fgOf(l) - rm(l);
    // incoming already allocated to this line from its purchase lines (capped at what is short; its ETA stays on `sources`)
    const own = clamp(purchase.filter((x) => x.l === l).reduce((a, x) => a + x.p.incomingQty, 0), 0, Math.max(0, short));
    if (own > 0) { inc.set(l.id, { qty: own, eta: null }); short -= own; }
    for (const r of ships) {
      // shortcut: a shipment serves only the line's own item code; match by spec once the CHINA SHIPMENTS reader brings L-fields.
      if (short <= 0) break;
      if (r.left <= 0 || code(r.erpCode) !== code(l.itemCode)) continue;
      const t = Math.min(short, r.left);
      const v = inc.get(l.id) ?? { qty: 0, eta: null };
      v.qty += t; v.eta = r.eta; inc.set(l.id, v);
      r.left -= t; short -= t;
    }
  }

  // outputs
  const byLine = new Map<string, Allocation[]>();
  for (const a of allocations) {
    if (a.stage === "Dispatched") continue;
    const k = `${a.contractNo}|${a.itemCode}`, b = byLine.get(k);
    if (b) b.push(a); else byLine.set(k, [a]);
  }
  const mine = (l: ContractLine) => byLine.get(`${l.contractNo}|${l.itemCode}`) ?? [];
  const offerNow: OfferLine[] = [];
  for (const l of live) {
    // a booking may hold more, and qty still awaiting an MC is held but cannot be offered
    const qty = Math.min(held(l) + rm(l), q(l).onb + q(l).bto);
    const locked = input.ledger.filter((e) => e.source === "locked" && e.contractNo === l.contractNo && e.itemCode === l.itemCode);
    // a locked line stays listed at 0 (its actuator gone), so Offer sent can be unticked to free the valve;
    // an MC-pending line cannot be offered yet
    if ((qty <= 0 || l.mcPending) && !locked.length) continue;
    const my = mine(l), rmCodes = new Map<string, OfferLine["rmCodes"][number]>();
    for (const a of my) {
      const k = `${a.erpCode}|${a.location}`;
      const r = rmCodes.get(k) ?? { erpCode: a.erpCode, location: a.location, qty: 0, spare: a.spare };
      r.qty += a.qty; rmCodes.set(k, r);
    }
    const basis: Basis = pl.get(l.id)!.actuated ? "Actuator to map" : my.some((a) => a.spare) ? "Assemble" : "Finished";
    offerNow.push({
      line: l, offerableQty: qty, offerValue: qty * l.rate, rmCodes: [...rmCodes.values()], basis,
      flags: [...new Set(my.flatMap((a) => a.flags))], offerSent: locked.length > 0,
      remarks: locked.find((e) => e.remarks)?.remarks ?? null,
    });
  }

  const views = new Map<string, AllocationResult["ledger"][number]>();
  for (const s of stock) {
    const k = `${s.erpCode}|${s.location}`;
    const v = views.get(k) ?? {
      erpCode: s.erpCode, location: s.location, availableQty: 0, allocatedTo: [], allocatedQty: 0, freeBalance: 0,
      description: [s.valveType, s.dimension, s.component, s.material, s.std, s.pn].filter(Boolean).join(" "),
    };
    v.availableQty += s.availableQty; views.set(k, v);
  }
  for (const a of allocations) {
    const v = views.get(`${a.erpCode}|${a.location}`);
    if (a.stage === "Dispatched" || !v) continue;
    v.allocatedTo.push({ contractNo: a.contractNo, itemCode: a.itemCode, qty: a.qty, stage: a.stage });
    v.allocatedQty += a.qty;
  }
  const ledgerView = [...views.values()];
  ledgerView.forEach((v) => (v.freeBalance = Math.max(0, v.availableQty - v.allocatedQty)));

  // MC-received lines only, as before; Blue Star is left out
  const byContract = new Map<string, AllocationResult["notInStock"][number]>();
  for (const l of live) {
    const shortQty = l.balanceQty - held(l) - rm(l);
    if (shortQty <= 0 || l.mcPending || blueStar(l)) continue;
    const c = byContract.get(l.contractNo) ?? { contractNo: l.contractNo, party: l.party, shortValue: 0, lines: [] };
    const shortValue = shortQty * l.rate;
    c.lines.push({ line: l, shortQty, shortValue }); c.shortValue += shortValue; byContract.set(l.contractNo, c);
  }
  const notInStock = [...byContract.values()];

  const lines = live.map((l): LineAllocation => {
    const p = pl.get(l.id)!, { bto } = q(l), fgQty = fgOf(l), rmRouteQty = rm(l), i = inc.get(l.id);
    const incomingQty = i?.qty ?? 0, gap = bto - fgQty - rmRouteQty;
    const flags = [...new Set(mine(l).flatMap((a) => a.flags))];
    const lineFlags = [...flags, ...(extraFlags.get(l.id) ?? [])];
    const sources = purchase.filter((x) => x.l === l).flatMap(({ p }) => ([["received", p.physicalQty], ["incoming", p.incomingQty], ["short", p.shortQty]] as const)
      .filter(([, n]) => n > 0)
      .map(([state, n]): PurchaseSource => ({
        poNo: p.poNo, poLineNo: p.poLineNo, lot: p.lot, tinaInvoiceNo: p.tinaInvoiceNo, blNo: p.blNo, eta: p.eta, qty: n, state,
        needsConfirmation: p.needsConfirmation,
      })));
    const gb = (l.rmCodeForGb ?? "").split(",").map(code).filter(Boolean);
    // stock of the other drilling standard is never allocated; shown as possible after machining
    // shortcut: the same free stock can be suggested to several short lines; hold it per line if suggestions become bookings.
    const machinable = new Map<string, number>();
    if (gap > 0 && !blueStar(l)) {
      for (const n of p.needs) for (const s of n === ACTUATOR ? [] : pool(n, p)) {
        const sp = ps.get(s.id)!;
        if (sp.drill !== p.drill && free.get(s.id)! > 0 && match(n, p, sp, true)) {
          machinable.set(s.erpCode, (machinable.get(s.erpCode) ?? 0) + free.get(s.id)!);
        }
      }
    }
    return {
      id: l.id, balanceToOffer: bto, fgQty, rmRouteQty, incomingQty, eta: i?.eta ?? null,
      shortfall: Math.max(0, gap - incomingQty),
      status: blueStar(l) ? "Blue Star - left out for now"
        : bto <= 0 ? "Fully offered"
        : fgQty >= bto ? (l.mcPending ? "MC pending - stock held" : flags.includes(WIRING_FLAG) ? "Allocated - wiring change required" : "Ready for inspection call")
        : fgQty + rmRouteQty > 0 ? "Partial" : "Not available",
      actuatorFree: p.act ? freeOf(pool(ACTUATOR, p).filter((s) => ps.get(s.id)!.act === p.act)) : null,
      gbFree: gb.length ? freeOf([...new Set(gb)].flatMap(rowsOf)) : null,
      flags: lineFlags, sources,
      suggestions: [...machinable].map(([erpCode, n]) => ({ erpCode, qty: Math.min(n, gap), note: "possible after machining" })),
    };
  });

  const sum = (b: Basis) => offerNow.filter((o) => o.basis === b && o.offerableQty > 0);
  const val = (b: Basis) => sum(b).reduce((a, o) => a + o.offerValue, 0);
  return {
    allocations, offerNow, ledger: ledgerView, notInStock, lines,
    summary: {
      finished: val("Finished"), assemble: val("Assemble"), actuator: val("Actuator to map"),
      short: notInStock.reduce((a, c) => a + c.shortValue, 0),
      finishedLines: sum("Finished").length, assembleLines: sum("Assemble").length, actuatorLines: sum("Actuator to map").length,
    },
  };
}
