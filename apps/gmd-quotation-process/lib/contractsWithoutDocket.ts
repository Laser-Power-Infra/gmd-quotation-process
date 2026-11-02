import { isLiveStatus } from "./indentListingLiveFilter";
import { normalizeContractKey } from "./contractDocketMatch";

export type CrRow = {
  contractNo: string;
  status: string | null;
  partyNameDump: string | null;
  dateOfContract: string | null;
  itemCode: string;
  item: string | null;
  size: string | null;
  orderQty: string | null;
  offerNumber: string[];
};

export type ContractNoDocket = {
  contractNo: string;
  party: string;
  contractDate: string;
  offers: string[];
  items: string;
  qty: number;
  lines: number;
};

function summarizeItems(rs: CrRow[]): string {
  const n = new Map<string, number>();
  for (const r of rs) { const k = (r.item || r.itemCode).trim(); n.set(k, (n.get(k) ?? 0) + 1); }
  return [...n].map(([k, c]) => `${k} x${c}`).join(", ");
}

/** Live = at least one line with blank STATUS (same rule as listLiveContractsAction). No docket = no Enquiry.selectedContractNo carries the contract no. */
export function liveContractsWithoutDocket(rows: CrRow[], linkedContractNos: Iterable<string>): ContractNoDocket[] {
  const linked = new Set([...linkedContractNos].map(normalizeContractKey));
  const by = new Map<string, { live: boolean; rows: CrRow[] }>();
  for (const r of rows) {
    const k = normalizeContractKey(r.contractNo);
    if (!k) continue;
    const c = by.get(k) ?? { live: false, rows: [] };
    c.live ||= isLiveStatus(r.status);
    c.rows.push(r);
    by.set(k, c);
  }
  const out: ContractNoDocket[] = [];
  for (const [k, c] of by) {
    if (!c.live || linked.has(k)) continue;
    const rs = c.rows;
    out.push({
      contractNo: rs[0].contractNo.trim(),
      party: rs.find((r) => r.partyNameDump)?.partyNameDump ?? "",
      contractDate: rs.find((r) => r.dateOfContract)?.dateOfContract ?? "",
      offers: [...new Set(rs.flatMap((r) => r.offerNumber).map((o) => o.trim()).filter((o) => o && o !== "0"))],
      items: summarizeItems(rs),
      qty: rs.reduce((s, r) => s + (parseFloat((r.orderQty ?? "").replace(/,/g, "")) || 0), 0),
      lines: rs.length,
    });
  }
  return out.sort((a, b) => a.contractNo.localeCompare(b.contractNo));
}
