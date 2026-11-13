import { ACTUATOR, parseLine, parseStock, type ParsedLine, type ParsedStock } from "./parse";
import type {
  Allocation, AllocationResult, Basis, ContractLine, LedgerEntry, OfferLine, Stage, StockItem,
} from "./types";

export { parseLine, parseStock };

const ACT_FLAG = "actuator held from stock";
const CS_FLAG = "CS offered against DI";
const SLV = "SLUICE VALVE";
const bad = (s: string | null | undefined) => { const t = (s ?? "").trim(); return !t || t === "#N/A"; };

/** null = no match; else a sort rank (lower first) and flags. */
function match(need: string, l: ParsedLine, s: ParsedStock): { rank: number; flags: string[] } | null {
  if (need === ACTUATOR) return s.act !== null && s.act === l.act ? { rank: 0, flags: [] } : null;
  if (s.vt !== need || s.size !== l.size || (s.metal !== null && s.metal !== l.metal)) return null;
  const flags: string[] = [];
  let rank = 0;
  if (s.mat !== l.mat) {
    if (!(need === SLV && l.mat === "DI" && s.mat === "CS")) return null;
    flags.push(CS_FLAG); rank += 10;
  }
  if (need === SLV && s.rising !== l.rising) return null;
  if (l.drill === "9523" && s.drill !== "9523") return null;
  if (l.drill === "1538" && s.drill) return null;
  if (l.pn && s.pn) {
    if (l.pn.cls || s.pn.cls) { if (l.pn.cls !== s.pn.cls || l.pn.n !== s.pn.n) return null; }
    else if (l.pn.n <= 16) {
      if (s.pn.n === 25) { if (l.size > 80) return null; rank += 5; }
      else if (s.pn.n !== 16 && s.pn.n !== 10) return null;
    } else if (s.pn.n !== 25) return null;
  }
  return { rank, flags };
}

export function allocateStock(input: { stock: StockItem[]; lines: ContractLine[]; ledger: LedgerEntry[] }): AllocationResult {
  const stock = input.stock.filter((s) => !bad(s.erpCode) && s.availableQty > 0);
  const ps = new Map(stock.map((s) => [s.id, parseStock(s)]));
  const free = new Map(stock.map((s) => [s.id, s.availableQty]));
  const live = input.lines.filter((l) => l.balanceQty > 0);
  const pl = new Map(live.map((l) => [l.id, parseLine(l)]));
  const allocations: Allocation[] = [];
  // per line: qty got per part (valve type or ACTUATOR); a line with several parts needs all of them
  const got = new Map<string, Map<string, number>>(live.map((l) => [l.id, new Map()]));
  const stageOf = (l: ContractLine): Stage => l.inspection === "DONE" ? "Inspection done" : l.offer === "DONE" ? "Offered" : "Booked";

  const add = (l: ContractLine, s: StockItem, qty: number, a: Partial<Allocation> & { flags: string[] }) => {
    const p = ps.get(s.id)!, acted = pl.get(l.id)!.actuated;
    free.set(s.id, free.get(s.id)! - qty);
    const g = got.get(l.id)!; g.set(p.vt, (g.get(p.vt) ?? 0) + qty);
    allocations.push({
      stockId: s.id, erpCode: s.erpCode, location: s.location, contractNo: l.contractNo, itemCode: l.itemCode,
      party: l.party, poNo: l.poNo, qty, stage: stageOf(l),
      basis: acted ? "Actuator to map" : p.kind === "assemble" ? "Assemble" : "Finished",
      source: "auto", ledgerId: null, spare: p.kind === "assemble", allocatedAt: null, ...a,
      // only the actuator's own row says so: a locked valve with no actuator free must not claim one
      flags: p.vt === ACTUATOR ? [...a.flags, ACT_FLAG] : a.flags,
    });
  };

  // 1. ledger, oldest first
  const ledger = [...input.ledger].sort((a, b) => a.allocatedAt.localeCompare(b.allocatedAt));
  for (const e of ledger) {
    const code = e.erpCode.trim().toUpperCase();
    const rows = stock.filter((s) => s.erpCode.trim().toUpperCase() === code && (!e.location || s.location === e.location));
    const l = live.find((x) => x.contractNo === e.contractNo && x.itemCode === e.itemCode);
    if (!l) { // closed or missing line: history only, takes no stock
      allocations.push({
        stockId: rows[0]?.id ?? "", erpCode: code, location: e.location, contractNo: e.contractNo, itemCode: e.itemCode,
        party: input.lines.find((x) => x.contractNo === e.contractNo)?.party ?? "", poNo: null, qty: e.qty,
        stage: "Dispatched", basis: e.basis ?? "Finished", source: e.source, ledgerId: e.id, spare: false,
        flags: [], allocatedAt: e.allocatedAt,
      });
      continue;
    }
    let left = e.qty;
    for (const s of rows) {
      const q = Math.min(left, free.get(s.id)!);
      if (q <= 0) continue;
      add(l, s, q, { source: e.source, ledgerId: e.id, allocatedAt: e.allocatedAt, flags: [], ...(e.basis ? { basis: e.basis } : {}) });
      left -= q;
    }
  }

  const offered = (l: ContractLine) => {
    const g = got.get(l.id)!, n = pl.get(l.id)!.needs;
    return n.length > 1 ? Math.min(...n.map((k) => g.get(k) ?? 0)) : [...g.values()].reduce((a, b) => a + b, 0);
  };

  // 2-4. lines by priority
  const pending = (l: ContractLine) => l.inspection !== "DONE" && l.offer !== "DONE";
  // same date (or both undated: Infinity - Infinity = NaN) falls back to id, so DB row order never decides
  const oldestFirst = (a: ContractLine, b: ContractLine) => pl.get(a.id)!.time - pl.get(b.id)!.time || a.id.localeCompare(b.id);
  const order = [
    ...live.filter((l) => l.inspection === "DONE").sort(oldestFirst),
    ...live.filter((l) => l.inspection !== "DONE" && l.offer === "DONE").sort(oldestFirst),
    ...live.filter(pending).sort(oldestFirst),
  ];
  for (const l of order) {
    const p = pl.get(l.id)!;
    // candidates per valve type, best first (exact finished code, other finished, assemble for pending lines only)
    const take = (need: string, cap: number, commit: boolean) => {
      const c = stock.flatMap((s) => {
        const sp = ps.get(s.id)!;
        if (!sp.kind || (sp.kind === "assemble" && !pending(l))) return [];
        const m = match(need, p, sp);
        if (!m) return [];
        const exact = sp.kind === "finished" && s.erpCode.trim().toUpperCase() === l.itemCode.trim().toUpperCase();
        return [{ s, flags: m.flags, key: [sp.kind === "assemble" ? 2 : exact ? 0 : 1, m.rank] }];
      }).sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
      let left = cap;
      for (const { s, flags } of c) {
        const q = Math.min(left, free.get(s.id)!);
        if (q <= 0) continue;
        if (commit) add(l, s, q, { flags });
        left -= q;
      }
      return cap - left;
    };
    if (!p.needs.length) continue;
    const g = got.get(l.id)!, have = (n: string) => g.get(n) ?? 0;
    // Every part is filled to the same reach: a part the ledger already holds (a locked valve) gets the
    // others on top, and a line missing one part (no matching actuator) takes nothing, leaving the rest free.
    const reach = Math.min(...p.needs.map((n) => have(n) + take(n, l.balanceQty - have(n), false)));
    for (const n of p.needs) if (reach > have(n)) take(n, reach - have(n), true);
  }

  // outputs
  const offerNow: OfferLine[] = [];
  for (const l of live) {
    const qty = Math.min(offered(l), l.balanceQty); // a booking may hold more than the balance
    const locked = input.ledger.filter((e) => e.source === "locked" && e.contractNo === l.contractNo && e.itemCode === l.itemCode);
    // a locked line stays listed at 0 (its actuator gone), so Offer sent can be unticked to free the valve
    if (qty <= 0 && !locked.length) continue;
    const mine = allocations.filter((a) => a.contractNo === l.contractNo && a.itemCode === l.itemCode && a.stage !== "Dispatched");
    const rm = new Map<string, OfferLine["rmCodes"][number]>();
    for (const a of mine) {
      const k = `${a.erpCode}|${a.location}`;
      const r = rm.get(k) ?? { erpCode: a.erpCode, location: a.location, qty: 0, spare: a.spare };
      r.qty += a.qty; rm.set(k, r);
    }
    const basis: Basis = pl.get(l.id)!.actuated ? "Actuator to map" : mine.some((a) => a.spare) ? "Assemble" : "Finished";
    offerNow.push({
      line: l, offerableQty: qty, offerValue: qty * l.rate, rmCodes: [...rm.values()], basis,
      flags: [...new Set(mine.flatMap((a) => a.flags))], offerSent: locked.length > 0,
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

  const byContract = new Map<string, AllocationResult["notInStock"][number]>();
  for (const l of live) {
    const shortQty = l.balanceQty - offered(l);
    if (shortQty <= 0) continue;
    const c = byContract.get(l.contractNo) ?? { contractNo: l.contractNo, party: l.party, shortValue: 0, lines: [] };
    const shortValue = shortQty * l.rate;
    c.lines.push({ line: l, shortQty, shortValue }); c.shortValue += shortValue; byContract.set(l.contractNo, c);
  }
  const notInStock = [...byContract.values()];

  const sum = (b: Basis) => offerNow.filter((o) => o.basis === b && o.offerableQty > 0);
  const val = (b: Basis) => sum(b).reduce((a, o) => a + o.offerValue, 0);
  return {
    allocations, offerNow, ledger: ledgerView, notInStock,
    summary: {
      finished: val("Finished"), assemble: val("Assemble"), actuator: val("Actuator to map"),
      short: notInStock.reduce((a, c) => a + c.shortValue, 0),
      finishedLines: sum("Finished").length, assembleLines: sum("Assemble").length, actuatorLines: sum("Actuator to map").length,
    },
  };
}
