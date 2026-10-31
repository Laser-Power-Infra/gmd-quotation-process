import "server-only";

import { prisma } from "@/lib/prisma";
import { computeDebtorTotals } from "@/lib/debtors";
import type { DebtorRow, DebtorsResult } from "@/lib/debtors";
import { buildBillInfo, buildFollowUps } from "@/lib/debtorJoins";
import type { FollowUp } from "@/lib/debtorJoins";
import { readSheetTabByTitleIfPresent } from "@/lib/gmd_lib/bomMastErp";

// Optional follow-up tabs are read live; cached briefly so the page does not hit the Sheets API every load.
let followCache: { at: number; data: Record<string, FollowUp> } | null = null;
async function getFollowUps(): Promise<Record<string, FollowUp>> {
  const id = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!id) return {};
  if (followCache && Date.now() - followCache.at < 5 * 60_000) return followCache.data;
  try {
    const [alloc, log] = await Promise.all([
      readSheetTabByTitleIfPresent(id, "OS_STAFF_ALLOC"),
      readSheetTabByTitleIfPresent(id, "OS_FOLLOWUP_LOG"),
    ]);
    followCache = { at: Date.now(), data: buildFollowUps(alloc, log) };
    return followCache.data;
  } catch {
    return {}; // follow-up columns are optional; never fail the page
  }
}

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function getDebtors(): Promise<DebtorsResult> {
  const [bills, regs, bgRecords, followUps] = await Promise.all([
    prisma.saleBill.findMany({ select: { vrNo: true, orderVrNo: true, partyRefNo: true, itemCode: true } }),
    prisma.saleRegister.findMany({ select: { invoiceNo: true, itemName: true, orderCopy: true, invoice: true, inspectionReport: true, driveLink: true } }),
    prisma.bankGuarantee.findMany({ select: { beneficiaryName: true, bgAmt: true, cancelledStatus: true } }),
    getFollowUps(),
  ]);

  const records = await prisma.debtor.findMany({
    orderBy: [{ dueDate: "asc" }, { accCode: "asc" }],
    select: {
      id: true,
      accSch: true,
      accCode: true,
      accName: true,
      tCode: true,
      vrNo: true,
      vrDate: true,
      dueDate: true,
      particular: true,
      drAmt: true,
      drAllocAmt: true,
      unAllocDr: true,
      unAllocCr: true,
      partyBillNo: true,
      partyBillDate: true,
      syncedAt: true,
    },
  });

  const rows: DebtorRow[] = records.map((row) => ({
    id: row.id,
    accSch: row.accSch,
    accCode: row.accCode,
    accName: row.accName,
    tCode: row.tCode,
    vrNo: row.vrNo,
    vrDate: toIso(row.vrDate),
    dueDate: toIso(row.dueDate),
    particular: row.particular,
    drAmt: toNum(row.drAmt),
    drAllocAmt: toNum(row.drAllocAmt),
    unAllocDr: toNum(row.unAllocDr),
    unAllocCr: toNum(row.unAllocCr),
    partyBillNo: row.partyBillNo,
    partyBillDate: toIso(row.partyBillDate),
  }));

  const latestSyncedAt = records.reduce<Date | null>(
    (latest, row) => (latest === null || row.syncedAt > latest ? row.syncedAt : latest),
    null,
  );

  return {
    rows,
    totals: computeDebtorTotals(rows),
    syncedAt: latestSyncedAt ? latestSyncedAt.toISOString() : null,
    billInfo: buildBillInfo(bills, regs),
    bgs: bgRecords.map((b) => ({ ...b, bgAmt: toNum(b.bgAmt) })),
    followUps,
  };
}
