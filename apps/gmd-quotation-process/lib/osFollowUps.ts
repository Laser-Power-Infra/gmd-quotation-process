/**
 * Per-party outstanding feed for the n8n follow-up workflows (staff reminders,
 * client payment messages). Pure: no Prisma import. Everything n8n needs to
 * group by owner, pick a message stage and apply the stop rules is here, so the
 * workflow never reads the sheet or re-does the ageing maths.
 */
import { daysOverdue, effectiveDueDate, outstanding, summarise } from "./debtorsAgeing";
import type { LedgerRow } from "./debtorsAgeing";
import { billInfoFor, followUpFor } from "./debtorJoins";
import type { BillInfo, FollowUp } from "./debtorJoins";
import { isUnderLitigation } from "./legalStatus";
import { istDateOnly } from "./pbg/reminder-rules";

export type FeedRow = LedgerRow & { vrNo: string | null };

export type FeedBill = {
  vrNo: string | null;
  vrDate: string | null; // yyyy-mm-dd
  dueDate: string | null; // yyyy-mm-dd; voucher date when the bill has none
  orderNo: string | null;
  poRef: string | null;
  balance: number;
  daysOverdue: number | null; // negative = due in that many days
};

export type FeedParty = {
  accCode: string;
  accName: string;
  owner: string | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  clientType: string | null;
  totalDues: number;
  overdue: number;
  over90: number;
  credits: number;
  net: number;
  oldestOverdueDays: number | null;
  lastFollowUp: string | null;
  daysSinceFollowUp: number | null;
  promisedDate: string | null;
  promisedAmount: number | null;
  promiseMissed: boolean; // promised date passed and the party is still overdue
  nextActionDate: string | null;
  status: string | null;
  bills: FeedBill[]; // open bills (balance > 0), oldest due first
};

export type OsFollowUpFeed = {
  date: string; // yyyy-mm-dd, India
  parties: FeedParty[]; // overdue desc, same order as the Debtors page
  excluded: { underLitigation: number };
};

const ymd = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const num = (s: string | null) => {
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Parties under litigation are left out: they have their own legal track and get no reminder of any kind. */
export function buildOsFollowUpFeed(
  rows: FeedRow[],
  followUps: Record<string, FollowUp>,
  legalStatus: Record<string, { status: string | null }>,
  billInfo: Record<string, BillInfo>,
  today: Date,
): OsFollowUpFeed {
  const byParty = new Map<string, FeedBill[]>();
  for (const r of rows) {
    const balance = outstanding(r);
    if (balance <= 0) continue;
    const due = effectiveDueDate(r.dueDate, r.vrDate);
    const info = billInfoFor(billInfo, r.vrNo);
    const list = byParty.get(r.accCode) ?? [];
    list.push({
      vrNo: r.vrNo,
      vrDate: ymd(r.vrDate),
      dueDate: ymd(due),
      orderNo: info?.orderNo ?? null,
      poRef: info?.poRef ?? null,
      balance,
      daysOverdue: daysOverdue(due, today),
    });
    byParty.set(r.accCode, list);
  }

  let underLitigation = 0;
  const parties: FeedParty[] = [];
  for (const p of summarise(rows, today).parties) {
    if (isUnderLitigation(legalStatus[p.accCode]?.status)) {
      underLitigation++;
      continue;
    }
    const f = followUpFor(followUps, p.accCode);
    const bills = (byParty.get(p.accCode) ?? []).sort((a, b) => (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity));
    const oldest = bills[0]?.daysOverdue ?? null;
    const promisedPast = f?.promisedDate ? (daysOverdue(f.promisedDate, today) ?? 0) > 0 : false;
    parties.push({
      accCode: p.accCode,
      accName: p.accName,
      owner: f?.owner ?? null,
      contact: { name: f?.contactName ?? null, phone: f?.contactPhone ?? null, email: f?.contactEmail ?? null },
      clientType: f?.clientType ?? null,
      totalDues: p.totalDues,
      overdue: p.overdue,
      over90: p.over90,
      credits: p.credits,
      net: p.net,
      oldestOverdueDays: oldest !== null && oldest > 0 ? oldest : null,
      lastFollowUp: f?.lastFollowUp ?? null,
      daysSinceFollowUp: f?.lastFollowUp ? daysOverdue(f.lastFollowUp, today) : null,
      promisedDate: f?.promisedDate ?? null,
      promisedAmount: num(f?.promisedAmount ?? null),
      promiseMissed: promisedPast && p.overdue > 0,
      nextActionDate: f?.nextActionDate ?? null,
      status: f?.status ?? null,
      bills,
    });
  }
  return { date: istDateOnly(today), parties, excluded: { underLitigation } };
}
