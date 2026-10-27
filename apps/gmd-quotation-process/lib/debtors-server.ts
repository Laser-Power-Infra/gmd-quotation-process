import "server-only";

import { prisma } from "@/lib/prisma";
import { computeDebtorTotals } from "@/lib/debtors";
import type { DebtorRow, DebtorsResult } from "@/lib/debtors";

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function getDebtors(): Promise<DebtorsResult> {
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
  };
}
