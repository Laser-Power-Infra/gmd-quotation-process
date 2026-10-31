/**
 * Contract <-> docket matching. Pure, so the rules are unit-tested without a DB.
 *
 *  - `rankDocketsForContracts`: suggest the docket a contract came from. Score =
 *    item codes whose TOTAL qty on the docket equals the TOTAL order qty over the
 *    contract set (the picked contracts plus any the docket already carries, so a
 *    docket split over several contracts, e.g. 312 -> SD26Y-00067..70, still adds up).
 *  - `findCodeMismatches`: a docket line whose (size, qty) matches a line of its
 *    linked contracts but whose item code is on none of those lines.
 */

/** Same rule as `normalizeContractKey` in gmd_lib/contract-review-enquiry-backfill (which pulls in Prisma). */
export function normalizeContractKey(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export type ContractLine = {
  contractNo: string;
  itemCode: string | null;
  size: string | null;
  orderQty: string | null;
  rate: string | null;
};

export type DocketLine = {
  id: string;
  itemName?: string | null;
  erpItemCode: string | null;
  size?: string | null;
  quantity: number | string | { toString(): string } | null;
};

export type DocketForMatch = {
  id: string;
  docketNumber: string;
  partyName: string;
  enquiryDate: Date | string;
  selectedContractNo: string[];
  items: DocketLine[];
};

export type DocketSuggestion = {
  id: string;
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  /** Contract set the qty totals were taken over. */
  contractNos: string[];
  /** Codes with equal total qty. */
  matchedCodes: string[];
  /** Codes on both sides, any qty. */
  commonCodes: number;
  /** Distinct codes over the contract set. */
  contractCodes: number;
};

/** Party names differ in punctuation / "LTD" vs "LIMITED" between the sheets. */
export function normalizeParty(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\bLTD\b/g, "LIMITED")
    .replace(/\bPVT\b/g, "PRIVATE")
    .replace(/\s+/g, " ")
    .trim();
}

export const codeKey = normalizeContractKey;

/** "1,200.00" -> 1200; blank / junk -> NaN. */
export function parseNum(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  const s = String(value).replace(/,/g, "").trim();
  return s === "" ? NaN : Number(s);
}

/** "DN 80", "80 MM", "80" -> "80". Sizes are stored as plain mm numbers on both sides. */
export function sizeKey(value: string | null | undefined): string {
  const m = String(value ?? "").match(/\d+(\.\d+)?/);
  return m ? String(Number(m[0])) : "";
}

function sameQty(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function sumByCode<T>(rows: T[], code: (r: T) => string | null, qty: (r: T) => unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = codeKey(code(r));
    const n = parseNum(qty(r));
    if (!k || !Number.isFinite(n)) continue;
    out.set(k, (out.get(k) ?? 0) + n);
  }
  return out;
}

export function contractQtyByCode(lines: ContractLine[]): Map<string, number> {
  return sumByCode(lines, (l) => l.itemCode, (l) => l.orderQty);
}

export function docketQtyByCode(items: DocketLine[]): Map<string, number> {
  return sumByCode(items, (i) => i.erpItemCode, (i) => (i.quantity === null ? null : String(i.quantity)));
}

/** Codes whose total qty is equal on both sides. */
export function equalQtyCodes(contractQty: Map<string, number>, docketQty: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [code, q] of contractQty) {
    const d = docketQty.get(code);
    if (d !== undefined && sameQty(d, q)) out.push(code);
  }
  return out.sort();
}

/** Lines of every contract in `contractNos` (normalised contract-no compare). */
function linesFor(contractNos: string[], linesByContract: Map<string, ContractLine[]>): ContractLine[] {
  return [...new Set(contractNos.map(normalizeContractKey))].flatMap((k) => linesByContract.get(k) ?? []);
}

export function groupLinesByContract(lines: ContractLine[]): Map<string, ContractLine[]> {
  const out = new Map<string, ContractLine[]>();
  for (const l of lines) {
    const k = normalizeContractKey(l.contractNo);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(l);
    else out.set(k, [l]);
  }
  return out;
}

/** Union of two contract-no lists, keeping the first spelling and order. */
export function mergeContractNos(existing: string[], added: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cn of [...existing, ...added]) {
    const k = normalizeContractKey(cn);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(cn.trim());
  }
  return out;
}

/**
 * Rank `dockets` (already narrowed to the contract's party) for the picked
 * contracts. Ties: more common codes, then the newer docket.
 */
export function rankDocketsForContracts(
  pickedContractNos: string[],
  dockets: DocketForMatch[],
  linesByContract: Map<string, ContractLine[]>,
  top = 3,
): DocketSuggestion[] {
  // Only the picked contracts' codes score; the docket's other contracts only add to the totals,
  // so a docket already linked elsewhere is not credited with its own contract's codes.
  const pickedCodes = new Set(contractQtyByCode(linesFor(pickedContractNos, linesByContract)).keys());
  const scored = dockets.map((d) => {
    const contractNos = mergeContractNos(d.selectedContractNo ?? [], pickedContractNos);
    const cQty = contractQtyByCode(linesFor(contractNos, linesByContract));
    const dQty = docketQtyByCode(d.items);
    return {
      id: d.id,
      docketNumber: d.docketNumber,
      partyName: d.partyName,
      enquiryDate: new Date(d.enquiryDate).toISOString(),
      contractNos,
      matchedCodes: equalQtyCodes(cQty, dQty).filter((k) => pickedCodes.has(k)),
      commonCodes: [...pickedCodes].filter((k) => dQty.has(k)).length,
      contractCodes: pickedCodes.size,
    };
  });
  return scored
    .filter((s) => s.commonCodes > 0)
    .sort(
      (a, b) =>
        b.matchedCodes.length - a.matchedCodes.length ||
        b.commonCodes - a.commonCodes ||
        b.enquiryDate.localeCompare(a.enquiryDate),
    )
    .slice(0, top);
}

/**
 * The contract rate per matched code. A code whose lines across the contract
 * set carry different rates is left out (no single rate to write).
 */
export function contractRateByCode(lines: ContractLine[]): Map<string, number> {
  const rates = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = codeKey(l.itemCode);
    const r = parseNum(l.rate);
    if (!k || !Number.isFinite(r) || r <= 0) continue;
    const set = rates.get(k) ?? new Set<number>();
    set.add(r);
    rates.set(k, set);
  }
  const out = new Map<string, number>();
  for (const [k, set] of rates) if (set.size === 1) out.set(k, [...set][0]);
  return out;
}

export type CodeMismatch = {
  itemId: string;
  itemName: string | null;
  docketCode: string | null;
  size: string;
  qty: number;
  /** Codes on the linked contracts with the same size and qty. */
  contractCodes: string[];
};

/**
 * Docket lines whose code differs from the contract line of the same size and
 * qty. A line is flagged only when some contract line has its size + qty and
 * none of those lines carries its code.
 */
export function findCodeMismatches(items: DocketLine[], contractLines: ContractLine[]): CodeMismatch[] {
  const bySizeQty = new Map<string, Set<string>>();
  for (const l of contractLines) {
    const s = sizeKey(l.size);
    const q = parseNum(l.orderQty);
    const c = codeKey(l.itemCode);
    if (!s || !Number.isFinite(q) || !c) continue;
    const k = `${s}|${q}`;
    const set = bySizeQty.get(k) ?? new Set<string>();
    set.add(c);
    bySizeQty.set(k, set);
  }
  const out: CodeMismatch[] = [];
  for (const it of items) {
    const s = sizeKey(it.size);
    const q = parseNum(it.quantity === null ? null : String(it.quantity));
    if (!s || !Number.isFinite(q)) continue;
    const codes = bySizeQty.get(`${s}|${q}`);
    const mine = codeKey(it.erpItemCode);
    if (!codes || codes.has(mine)) continue;
    out.push({
      itemId: it.id,
      itemName: it.itemName ?? null,
      docketCode: it.erpItemCode,
      size: s,
      qty: q,
      contractCodes: [...codes].sort(),
    });
  }
  return out;
}
