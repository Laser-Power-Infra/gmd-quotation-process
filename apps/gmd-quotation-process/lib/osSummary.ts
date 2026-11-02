/** Daily outstanding (O/S) summary for the GMD Accounts WhatsApp message. Pure: no Prisma import. */
import { daysOverdue, formatLakh, outstanding, summarise } from "./debtorsAgeing";
import type { AgeingSummary, LedgerRow } from "./debtorsAgeing";
import { istDateOnly } from "./pbg/reminder-rules";

export type OsSummary = {
  date: string; // YYYY-MM-DD, India
  debtors: { totalDues: number; overdue: number; over45: number; credits: number; net: number; syncedAt: string | null };
  creditors: { totalDues: number; overdue: number; advances: number; netPayable: number; syncedAt: string | null };
  text: string;
};

/**
 * Debtors from the ledger rows; creditors from the summary the Creditors page already builds.
 * ">45 days" is the MSME limit: open bill balance whose bill (voucher) date is more than `msmeDays` old.
 */
export function buildOsSummary(
  debtorRows: LedgerRow[],
  creditor: Pick<AgeingSummary, "totalDues" | "overdue" | "credits" | "net">,
  today: Date,
  o: { msmeDays: number; debtorsSyncedAt: string | null; creditorsSyncedAt: string | null },
): OsSummary {
  const d = summarise(debtorRows, today);
  let over45 = 0;
  for (const r of debtorRows) {
    const bal = outstanding(r);
    const age = daysOverdue(r.vrDate, today);
    if (bal > 0 && age !== null && age > o.msmeDays) over45 += bal;
  }
  const date = istDateOnly(today);
  const text = [
    `*GMD O/S summary – ${date}*`,
    `Debtors: ${formatLakh(d.net)} net (dues ${formatLakh(d.totalDues)}, overdue ${formatLakh(d.overdue)}, >${o.msmeDays} days ${formatLakh(over45)})`,
    `Creditors: ${formatLakh(creditor.net)} net payable (bills ${formatLakh(creditor.totalDues)}, advances ${formatLakh(creditor.credits)})`,
  ].join("\n");
  return {
    date,
    debtors: { totalDues: d.totalDues, overdue: d.overdue, over45, credits: d.credits, net: d.net, syncedAt: o.debtorsSyncedAt },
    creditors: { totalDues: creditor.totalDues, overdue: creditor.overdue, advances: creditor.credits, netPayable: creditor.net, syncedAt: o.creditorsSyncedAt },
    text,
  };
}
