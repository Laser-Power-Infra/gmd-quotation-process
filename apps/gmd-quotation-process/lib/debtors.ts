/**
 * Read side of the debtors ledger.
 *
 * The rows are written by whatever sync is approved later; this module only
 * reads them. Money arrives as Prisma `Decimal`, so it is flattened to a number
 * here (same as `lib/pbg/pbg-data.ts`) before it reaches the table.
 */

export type DebtorRow = {
  id: string;
  accSch: string | null;
  accCode: string;
  accName: string | null;
  tCode: string | null;
  vrNo: string | null;
  vrDate: string | null;
  dueDate: string | null;
  particular: string | null;
  drAmt: number | null;
  drAllocAmt: number | null;
  unAllocDr: number | null;
  unAllocCr: number | null;
  partyBillNo: string | null;
  partyBillDate: string | null;
};

export type DebtorTotals = {
  drAmt: number;
  drAllocAmt: number;
  unAllocDr: number;
  unAllocCr: number;
};

export type DebtorsResult = {
  rows: DebtorRow[];
  totals: DebtorTotals;
  syncedAt: string | null;
};

function toNum(value: { toString(): string } | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Sums the four money columns, treating a missing value as zero. */
export function computeDebtorTotals(
  rows: Pick<DebtorRow, "drAmt" | "drAllocAmt" | "unAllocDr" | "unAllocCr">[],
): DebtorTotals {
  const totals: DebtorTotals = {
    drAmt: 0,
    drAllocAmt: 0,
    unAllocDr: 0,
    unAllocCr: 0,
  };
  for (const row of rows) {
    totals.drAmt += row.drAmt ?? 0;
    totals.drAllocAmt += row.drAllocAmt ?? 0;
    totals.unAllocDr += row.unAllocDr ?? 0;
    totals.unAllocCr += row.unAllocCr ?? 0;
  }
  return totals;
}

/** Client-side search across the columns the page exposes. */
export function filterDebtors(rows: DebtorRow[], query: string): DebtorRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [
      row.accCode,
      row.accName,
      row.vrNo,
      row.partyBillNo,
      row.particular,
    ].some((value) => (value ?? "").toLowerCase().includes(needle)),
  );
}

export async function getDebtors(): Promise<DebtorsResult> {
  // Imported lazily so the client table can reuse `filterDebtors` from this
  // module without pulling Prisma into the browser bundle.
  const { prisma } = await import("@/lib/prisma");

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
