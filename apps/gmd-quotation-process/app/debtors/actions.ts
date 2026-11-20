"use server";

import { contextFor, getDebtorSummary, listDebtorFacet, listDebtorPage } from "@gmd/debtors/server";
import { FOLLOW_UP_FIELDS } from "@gmd/debtors/columns";
import type { ActionResult, Bucket, DebtorBill, DebtorPartyRow, DebtorQuery, FollowUpHistoryRow } from "@gmd/debtors/types";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { loadMsmeSettings } from "@/lib/debtors-server";
import { bucketOf, daysOverdue, outstanding } from "@/lib/debtorsAgeing";
import { billInfoFor, buildBillInfo, creditNoteRefOf, creditNotesByBill } from "@/lib/debtorJoins";
import { getLedgerFollowUpHistoryAction, saveLedgerFollowUpAction } from "@/app/actions/ledgerFollowUp";
import { saveLegalCaseAction } from "@/app/actions/partyLegalCase";
import { LEGAL_FIELDS, type LegalCaseView } from "@/lib/legalStatus";

// Debtors page actions. Every one checks access; the SQL lives in @gmd/debtors.

async function guarded<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await requireAccess();
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const context = async () => contextFor(new Date(), await loadMsmeSettings());

export async function loadPage(query: TableQuery) {
  return guarded(async () => listDebtorPage(query as DebtorQuery, await context()));
}

export async function loadFacet(field: string, query: TableQuery) {
  return guarded(async () => listDebtorFacet(field, query as DebtorQuery, await context()));
}

export async function loadSummary() {
  return guarded(async () => getDebtorSummary(await context()));
}

const DOC_LINKS = [["orderCopy", "Order copy"], ["invoice", "Invoice"], ["inspectionReport", "Inspection"], ["driveLink", "Drive"]] as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** One party's open bills (and credits), oldest overdue first, with order / PO / documents and credit-note links. */
export async function loadBills(accCode: string, bucket: Bucket | null) {
  return guarded<DebtorBill[]>(async () => {
    const today = new Date();
    const rows = (await prisma.debtor.findMany({
      where: { accCode },
      select: { id: true, tCode: true, vrNo: true, vrDate: true, dueDate: true, particular: true, drAmt: true, drAllocAmt: true, unAllocDr: true, unAllocCr: true },
    })).map((r) => ({ ...r, vrDate: iso(r.vrDate), dueDate: iso(r.dueDate), drAmt: num(r.drAmt), drAllocAmt: num(r.drAllocAmt), unAllocDr: num(r.unAllocDr), unAllocCr: num(r.unAllocCr) }));
    const vrNos = [...new Set(rows.flatMap((r) => (r.vrNo ? [r.vrNo, r.vrNo.trim().toUpperCase()] : [])))];
    const [sales, regs] = await Promise.all([
      prisma.saleBill.findMany({ where: { vrNo: { in: vrNos } }, select: { vrNo: true, orderVrNo: true, partyRefNo: true, itemCode: true } }),
      prisma.saleRegister.findMany({ where: { invoiceNo: { in: vrNos } }, select: { invoiceNo: true, itemName: true, orderCopy: true, invoice: true, inspectionReport: true, driveLink: true } }),
    ]);
    const info = buildBillInfo(sales, regs);
    const credits = creditNotesByBill(rows);
    return rows
      .map((r) => ({ r, bal: outstanding(r), days: daysOverdue(r.dueDate, today) }))
      .filter((b) => b.bal !== 0 && (!bucket || (b.bal > 0 && bucketOf(b.days) === bucket)))
      .sort((a, b) => (b.days ?? -1e9) - (a.days ?? -1e9))
      .map(({ r, bal, days }) => {
        const i = billInfoFor(info, r.vrNo);
        const ref = creditNoteRefOf(r.particular, r.tCode);
        return {
          id: r.id,
          vrNo: r.vrNo,
          vrDate: r.vrDate,
          dueDate: r.dueDate,
          orderNo: i?.orderNo ?? r.particular,
          poRef: i?.poRef ?? null,
          items: i?.items ?? null,
          drAmt: r.drAmt,
          drAllocAmt: r.drAllocAmt,
          bal,
          days,
          // Credit shown against its bill ("SR26Y-00009") and on the credit row itself ("Against GD26Y-00139").
          creditNote: ref ? `Against ${ref}` : (credits.get((r.vrNo ?? "").replace(/\s+/g, " ").trim().toUpperCase())?.join(", ") ?? ""),
          links: DOC_LINKS.flatMap(([k, label]) => (i?.[k] ? [{ label, value: i[k]! }] : [])),
        };
      });
  });
}

export async function loadHistory(accCode: string) {
  return guarded<FollowUpHistoryRow[]>(() => getLedgerFollowUpHistoryAction("debtor", accCode));
}

/** One edited cell: the whole party-level follow-up / legal record is re-sent, as the save actions upsert it. */
export async function saveField(row: DebtorPartyRow, field: string, value: string): Promise<ActionResult<null>> {
  const v = value.trim() || null;
  const rec = row as unknown as Record<string, string | null>;
  if (FOLLOW_UP_FIELDS.includes(field)) {
    const follow = Object.fromEntries(FOLLOW_UP_FIELDS.map((k) => [k, k === field ? v : rec[k]]));
    const res = await saveLedgerFollowUpAction({ ledger: "debtor", accCode: row.accCode, ...follow });
    return res.success ? { success: true, data: null } : { success: false, error: res.error ?? "Could not save the follow-up." };
  }
  const legalKey = field === "legalStatus" ? "status" : field;
  if ((LEGAL_FIELDS as readonly string[]).includes(legalKey)) {
    const legal = Object.fromEntries(LEGAL_FIELDS.map((k) => [k, k === legalKey ? v : rec[k === "status" ? "legalStatus" : k]])) as Partial<LegalCaseView>;
    const res = await saveLegalCaseAction({ ledger: "debtor", accCode: row.accCode, ...legal });
    return res.success ? { success: true, data: null } : { success: false, error: res.error ?? "Could not save the legal details." };
  }
  return { success: false, error: "This column cannot be edited." };
}
