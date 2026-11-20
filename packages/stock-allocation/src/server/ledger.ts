import { stockPrisma } from "@gmd/db-stock";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { logRow, type AllocationLogPage } from "../allocationLog";
import type { Basis, LedgerEntry } from "../types";

type Row = Awaited<ReturnType<typeof stockPrisma.stockAllocation.findFirstOrThrow>>;

function toEntry(r: Row): LedgerEntry {
  return {
    id: r.id,
    erpCode: r.erpCode,
    location: r.location,
    contractNo: r.contractNo,
    itemCode: r.itemCode,
    qty: r.qty,
    source: r.source as LedgerEntry["source"],
    basis: r.basis as Basis | null,
    remarks: r.remarks,
    allocatedAt: r.allocatedAt.toISOString(),
  };
}

function need(v: string | null | undefined, label: string): string {
  const s = (v ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  return s;
}

function needQty(q: number): number {
  if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be greater than 0");
  return q;
}

const blankToNull = (v: string | null | undefined) => (v ?? "").trim() || null;

export async function listLedger(): Promise<LedgerEntry[]> {
  const rows = await stockPrisma.stockAllocation.findMany({ orderBy: { allocatedAt: "asc" } });
  return rows.map(toEntry);
}

// Each write below adds its log row(s) to the same batch transaction as the write.
// shortcut: rows are read before the batch, so concurrent writes to one line can log a stale old qty or miss a replaced lock; if that matters, read and write in one interactive transaction with a raised timeout (apps/gmd-quotation-process/lib/grnSync.ts does; Prisma's 5 s default is the P2028 risk).
const log = (...row: Parameters<typeof logRow>) => stockPrisma.stockAllocationLog.create({ data: logRow(...row) });

export async function addBooking(
  input: {
    erpCode: string;
    location: string | null;
    contractNo: string;
    itemCode: string;
    qty: number;
    remarks: string | null;
  },
  by: string | null,
): Promise<LedgerEntry> {
  const data = {
    erpCode: need(input.erpCode, "ERP code").toUpperCase(),
    location: blankToNull(input.location),
    contractNo: need(input.contractNo, "Contract no"),
    itemCode: need(input.itemCode, "Item code"),
    qty: needQty(input.qty),
    source: "manual",
    remarks: blankToNull(input.remarks),
  };
  const [row] = await stockPrisma.$transaction([stockPrisma.stockAllocation.create({ data }), log(by, null, data)]);
  return toEntry(row);
}

export async function updateBooking(
  id: string,
  input: { qty: number; remarks?: string | null },
  by: string | null,
): Promise<LedgerEntry> {
  // remarks omitted = keep the existing remarks
  const data = { qty: needQty(input.qty), ...(input.remarks === undefined ? {} : { remarks: blankToNull(input.remarks) }) };
  const before = await stockPrisma.stockAllocation.findUniqueOrThrow({ where: { id } });
  const [row] = await stockPrisma.$transaction([
    stockPrisma.stockAllocation.update({ where: { id }, data }),
    log(by, before, { ...before, ...data }),
  ]);
  return toEntry(row);
}

export async function deleteBooking(id: string, by: string | null): Promise<void> {
  const before = await stockPrisma.stockAllocation.findUniqueOrThrow({ where: { id } });
  await stockPrisma.$transaction([stockPrisma.stockAllocation.delete({ where: { id } }), log(by, before, null)]);
}

export async function lockOffer(
  input: {
    contractNo: string;
    itemCode: string;
    basis: Basis;
    remarks: string | null;
    rmCodes: { erpCode: string; location: string | null; qty: number }[];
  },
  by: string | null,
): Promise<LedgerEntry[]> {
  const contractNo = need(input.contractNo, "Contract no");
  const itemCode = need(input.itemCode, "Item code");
  const remarks = blankToNull(input.remarks);
  const data = input.rmCodes.map((r) => ({
    erpCode: need(r.erpCode, "ERP code").toUpperCase(),
    location: blankToNull(r.location),
    contractNo,
    itemCode,
    qty: needQty(r.qty),
    source: "locked",
    basis: input.basis,
    remarks,
  }));
  const where = { contractNo, itemCode, source: "locked" };
  // Locks this one replaces are logged as unlocked.
  const replaced = await stockPrisma.stockAllocation.findMany({ where });
  const rows = await stockPrisma.$transaction([
    stockPrisma.stockAllocation.deleteMany({ where }),
    ...data.map((d) => stockPrisma.stockAllocation.create({ data: d })),
    ...replaced.map((r) => log(by, r, null)),
    ...data.map((d) => log(by, null, d)),
  ]);
  return rows.slice(1, 1 + data.length).map((r) => toEntry(r as Row));
}

export async function unlockOffer(contractNo: string, itemCode: string, by: string | null): Promise<void> {
  const where = { contractNo: need(contractNo, "Contract no"), itemCode: need(itemCode, "Item code"), source: "locked" };
  const locked = await stockPrisma.stockAllocation.findMany({ where });
  await stockPrisma.$transaction([stockPrisma.stockAllocation.deleteMany({ where }), ...locked.map((r) => log(by, r, null))]);
}

/** One page of the allocation log, newest first; the search matches order line, stock code, who, action or note. */
export async function listAllocationLogPage(query: TableQuery): Promise<AllocationLogPage> {
  const take = Math.min(Math.max(1, query.pageSize), 200);
  const s = { contains: query.search.trim(), mode: "insensitive" as const };
  const where = s.contains ? { OR: [{ contractNo: s }, { itemCode: s }, { erpCode: s }, { by: s }, { action: s }, { note: s }] } : {};
  const [rows, total] = await Promise.all([
    stockPrisma.stockAllocationLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (Math.max(1, query.page) - 1) * take, take }),
    stockPrisma.stockAllocationLog.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...r, at: r.at.toISOString() })), total };
}
