/** Per-party MSME interest statement rows, plus GMD's Udyam identity. Pure: no Prisma import. */
import { daysOverdue } from "./debtorsAgeing";
import { msmeDueDate, msmeInterest } from "./msme";
import type { MsmeSettings } from "./msme";

export const GMD_UDYAM_NO = "UDYAM-WB-08-0001675";
export const GMD_UDYAM_CATEGORY = "Small";
/** One-line clause for the footer of quotations/offers. Puja reviews this copy. */
export const MSME_CLAUSE = `GMD is a Micro, Small & Medium Enterprise (Udyam Regn. No. ${GMD_UDYAM_NO}, Category: ${GMD_UDYAM_CATEGORY}). Payments are governed by the MSMED Act 2006; interest u/s 16 applies to payments beyond the agreed credit period (max 45 days).`;

export type StatementBill = { billNo: string; vrDate: string | null; bal: number };
export type StatementLine = { billNo: string; billDate: string; dueDate: string; daysOverdue: number; principal: number; interest: number };

/** Overdue bills only (days past the MSMED due date > 0), oldest first; interest accrues to `today`, same maths as partyMsme. */
export function buildInterestStatement(bills: StatementBill[], creditDays: number | null, s: MsmeSettings, today: Date) {
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const lines: StatementLine[] = [];
  for (const b of bills) {
    if (b.bal <= 0 || !b.vrDate) continue;
    const due = msmeDueDate(new Date(b.vrDate), creditDays, s.creditDaysNoAgreement);
    const days = daysOverdue(due.toISOString(), today);
    if (days === null || days <= 0) continue;
    lines.push({ billNo: b.billNo, billDate: b.vrDate.slice(0, 10), dueDate: due.toISOString().slice(0, 10), daysOverdue: days, principal: b.bal, interest: msmeInterest(b.bal, due, end, s.bankRatePct) });
  }
  lines.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const principal = lines.reduce((t, l) => t + l.principal, 0);
  const interest = lines.reduce((t, l) => t + l.interest, 0);
  return { lines, principal, interest, total: principal + interest };
}
