/** Pure joins/helpers for the Debtors dashboard: bill info, BG exposure, follow-ups, CSV. */

export type BillInfo = {
  orderNo: string | null; // SALE BILL ORDER_VRNO
  poRef: string | null; // SALE BILL PARTYREFNO
  items: string | null;
  orderCopy: string | null;
  invoice: string | null;
  inspectionReport: string | null;
  driveLink: string | null;
};
export type BgRow = { beneficiaryName: string | null; bgAmt: number | null; cancelledStatus: string | null };
export type FollowUp = { owner: string | null; lastFollowUp: string | null; promisedDate: string | null; promisedAmount: string | null; status: string | null };

type SaleBillIn = { vrNo: string; orderVrNo: string | null; partyRefNo: string | null; itemCode: string | null };
type SaleRegIn = { invoiceNo: string; itemName: string | null; orderCopy: string | null; invoice: string | null; inspectionReport: string | null; driveLink: string | null };

const key = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** One entry per VRNO / INVOICE NO. A sale bill can span several item rows: items are joined, first non-blank link wins. */
export function buildBillInfo(bills: SaleBillIn[], regs: SaleRegIn[]): Record<string, BillInfo> {
  const out: Record<string, BillInfo> = {};
  const get = (k: string) =>
    (out[k] ??= { orderNo: null, poRef: null, items: null, orderCopy: null, invoice: null, inspectionReport: null, driveLink: null });
  const addItem = (i: BillInfo, v: string | null) => {
    if (v && !(i.items ?? "").split(", ").includes(v)) i.items = i.items ? `${i.items}, ${v}` : v;
  };
  for (const b of bills) {
    const i = get(key(b.vrNo));
    i.orderNo ??= b.orderVrNo;
    i.poRef ??= b.partyRefNo;
    addItem(i, b.itemCode);
  }
  for (const r of regs) {
    const i = get(key(r.invoiceNo));
    i.orderCopy ||= r.orderCopy;
    i.invoice ||= r.invoice;
    i.inspectionReport ||= r.inspectionReport;
    i.driveLink ||= r.driveLink;
    addItem(i, r.itemName);
  }
  return out;
}
export const billInfoFor = (m: Record<string, BillInfo>, vrNo: string | null) => m[key(vrNo)];

/** Open (not CLOSED/CANCELLED) BG amount per party name.
 * shortcut: beneficiary matched to party by exact upper-cased, whitespace-collapsed name; 13 of 19 match today, upgrade to an alias table for the rest. */
export function bgExposureByName(bgs: BgRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bgs) {
    if (/CLOSED|CANCEL/.test(key(b.cancelledStatus))) continue;
    const k = key(b.beneficiaryName);
    if (k) m.set(k, (m.get(k) ?? 0) + (b.bgAmt ?? 0));
  }
  return m;
}
export const bgFor = (m: Map<string, number>, partyName: string) => m.get(key(partyName)) ?? 0;

/**
 * Follow-up tabs (read only if present). Expected headers, matched after normalisation, missing ones stay blank:
 * OS_STAFF_ALLOC: ACC_CODE, OWNER.  OS_FOLLOWUP_LOG: ACC_CODE, FOLLOWUP_DATE, PROMISED_DATE, PROMISED_AMOUNT, STATUS (later rows win).
 */
export function buildFollowUps(
  alloc: { headers: string[]; rows: string[][] } | null,
  log: { headers: string[]; rows: string[][] } | null,
): Record<string, FollowUp> {
  const out: Record<string, FollowUp> = {};
  const norm = (h: string) => key(h).replace(/_/g, " ");
  const col = (t: { headers: string[] }, name: string) => t.headers.map(norm).indexOf(norm(name));
  const val = (r: string[], i: number) => (i < 0 ? null : (r[i] ?? "").trim() || null);
  const slot = (code: string) => (out[key(code)] ??= { owner: null, lastFollowUp: null, promisedDate: null, promisedAmount: null, status: null });
  if (alloc) {
    const c = col(alloc, "ACC_CODE"), o = col(alloc, "OWNER");
    if (c >= 0) for (const r of alloc.rows) if (val(r, c)) slot(r[c]).owner = val(r, o);
  }
  if (log) {
    const c = col(log, "ACC_CODE"), d = col(log, "FOLLOWUP_DATE"), pd = col(log, "PROMISED_DATE"), pa = col(log, "PROMISED_AMOUNT"), s = col(log, "STATUS");
    if (c >= 0)
      for (const r of log.rows)
        if (val(r, c)) Object.assign(slot(r[c]), { lastFollowUp: val(r, d), promisedDate: val(r, pd), promisedAmount: val(r, pa), status: val(r, s) });
  }
  return out;
}
export const followUpFor = (m: Record<string, FollowUp>, accCode: string) => m[key(accCode)];

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const q = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
