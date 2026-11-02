import { formatLakh } from "@/lib/debtorsAgeing";
import type { AgeingSummary } from "@/lib/debtorsAgeing";

/**
 * O/S slice of the daily GMD accounts WhatsApp message (n8n posts it).
 * Bank balance, payments released and receipts are NOT here: no source in this
 * repo until Pritha's process doc says where they are read from.
 */
export function buildOsSummary(debtors: AgeingSummary, creditors: AgeingSummary, today: Date, syncedAt: string | null) {
  const d = (s: AgeingSummary) => ({ total: s.totalDues, overdue: s.overdue, over90: s.over90, credits: s.credits, net: s.net });
  const data = { date: today.toISOString().slice(0, 10), syncedAt, debtors: d(debtors), creditors: d(creditors) };
  const text = [
    `O/S as on ${data.date}`,
    `Debtors: ${formatLakh(debtors.totalDues)} (overdue ${formatLakh(debtors.overdue)}, >90 days ${formatLakh(debtors.over90)})`,
    `Creditors: net payable ${formatLakh(creditors.net)} (overdue ${formatLakh(creditors.overdue)})`,
  ].join("\n");
  return { data, text };
}
