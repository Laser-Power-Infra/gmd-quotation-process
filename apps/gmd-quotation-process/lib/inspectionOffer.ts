import { normalizeHeader, normalizeKey } from "@/lib/gmd_lib/ic-dump-merge";

/** Columns of INSPECTION OFFER DUMP (gid 148043829) by header name, so a shifted column still maps. */
export const OFFER_COLUMNS = [
  "VRNO", "VRDATE", "ITEM_CODE", "UM", "AQTYORDER", "ACC_CODE", "CONTRACT_VRNO", "INSPE_VRNO", "INSPE_DATE",
  "DI_VRNO", "DI_DATE", "INV_VRNO", "INV_VRDATE", "QTYCANCELLED", "IC_QTY", "DI_QTY", "DI_QTYCANCELLED", "INV_QTY",
  "BAL_INSP_OFF",
] as const;
export type OfferRow = Record<(typeof OFFER_COLUMNS)[number], string>;

/** Sheet values (header row first) -> one entry per offer VRNO, rows keyed by header. Throws if a header is missing. */
export function groupOffers(values: readonly (readonly unknown[])[]): Map<string, OfferRow[]> {
  const head = (values[0] ?? []).map((h) => normalizeHeader(String(h)));
  const idx = OFFER_COLUMNS.map((c) => head.indexOf(normalizeHeader(c)));
  const missing = OFFER_COLUMNS.filter((_, i) => idx[i] < 0);
  if (missing.length) throw new Error(`INSPECTION OFFER DUMP is missing columns: ${missing.join(", ")}`);
  const out = new Map<string, OfferRow[]>();
  for (const r of values.slice(1)) {
    const row = Object.fromEntries(OFFER_COLUMNS.map((c, i) => [c, String(r[idx[i]] ?? "").trim()])) as OfferRow;
    if (!row.VRNO) continue;
    out.set(row.VRNO, [...(out.get(row.VRNO) ?? []), row]);
  }
  return out;
}

/** The ContractReview columns the draft needs. */
export type ContractLine = {
  mcNo: string | null; itemCode: string; itemName: string | null; size: string | null; pnRating: string | null;
  orderQty: string | null; mcQty: string | null; balanceMc: string | null; dateOfContract: string | null;
  contractNo: string; partyNameDump: string | null; projectReference: string | null;
};

const n = (v: unknown) => {
  const x = Number(String(v ?? "").replace(/,/g, "").trim());
  return String(v ?? "").trim() !== "" && Number.isFinite(x) ? x : null;
};
// shortcut: reads dd/mm/yyyy, dd-mm-yyyy and ISO only; anything else is "unparseable" and skips the date-order check.
function date(v: string): number | null {
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) ?? v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return m[1].length === 4 ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.UTC(+m[3], +m[2] - 1, +m[1]);
}

/**
 * Draft inspection report for one offer: header + item lines from the offer and
 * its contract lines, and the validation findings that must clear before "Ready".
 * shortcut: QAP, tolerances, serials and MTC are not sourced yet, so they are listed as open issues, not filled.
 */
export function buildDraft(vrno: string, rows: readonly OfferRow[], contract: readonly ContractLine[]) {
  const first = rows[0];
  const issues: string[] = [];
  const items = rows.map((r) => {
    const c = contract.find((x) => normalizeKey(x.mcNo) === normalizeKey(r.CONTRACT_VRNO) && normalizeKey(x.itemCode) === normalizeKey(r.ITEM_CODE));
    const offered = (n(r.AQTYORDER) ?? 0) - (n(r.QTYCANCELLED) ?? 0);
    const contractQty = n(c?.mcQty ?? c?.orderQty);
    const inspected = n(r.IC_QTY) ?? 0;
    const balance = contractQty === null ? null : contractQty - inspected - offered;
    if (!c) issues.push(`${r.ITEM_CODE}: no Contract Review line for contract ${r.CONTRACT_VRNO}`);
    if (balance !== null && balance < 0) issues.push(`${r.ITEM_CODE}: offered ${offered} exceeds contract balance (${contractQty} - ${inspected} inspected)`);
    return {
      itemCode: r.ITEM_CODE, itemName: c?.itemName ?? null, size: c?.size ?? null, pn: c?.pnRating ?? null, um: r.UM,
      offeredQty: offered, contractQty, alreadyInspected: inspected, balance,
    };
  });
  const od = date(first.VRDATE);
  const id = date(first.INSPE_DATE);
  if (!first.INSPE_DATE) issues.push("Inspection date is blank");
  if (od !== null && id !== null && od > id) issues.push("Offer date is after the inspection date");
  const c0 = contract.find((x) => normalizeKey(x.mcNo) === normalizeKey(first.CONTRACT_VRNO));
  for (const [k, v] of [["Client", c0?.partyNameDump ?? first.ACC_CODE], ["Project name", c0?.projectReference], ["Contract date", c0?.dateOfContract]] as const) {
    if (!v) issues.push(`${k} is blank`);
  }
  issues.push("Open: QAP / test pressures, dimension tolerances, serial nos, MTC and calibration pages are not yet system-filled");
  const header = {
    offerNo: vrno, offerDate: first.VRDATE, contractNo: c0?.contractNo ?? first.CONTRACT_VRNO, mcNo: first.CONTRACT_VRNO, contractDate: c0?.dateOfContract ?? null,
    client: c0?.partyNameDump ?? first.ACC_CODE, project: c0?.projectReference ?? null, inspectionNo: first.INSPE_VRNO, inspectionDate: first.INSPE_DATE,
  };
  return { header, items, issues };
}
