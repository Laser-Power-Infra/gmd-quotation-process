import { stockPrisma } from "@/lib/stockPrisma";
import type { Basis, LedgerEntry } from "./types";

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

export async function addBooking(input: {
  erpCode: string;
  location: string | null;
  contractNo: string;
  itemCode: string;
  qty: number;
  remarks: string | null;
}): Promise<LedgerEntry> {
  const row = await stockPrisma.stockAllocation.create({
    data: {
      erpCode: need(input.erpCode, "ERP code").toUpperCase(),
      location: blankToNull(input.location),
      contractNo: need(input.contractNo, "Contract no"),
      itemCode: need(input.itemCode, "Item code"),
      qty: needQty(input.qty),
      source: "manual",
      remarks: blankToNull(input.remarks),
    },
  });
  return toEntry(row);
}

export async function updateBooking(
  id: string,
  input: { qty: number; remarks?: string | null },
): Promise<LedgerEntry> {
  const row = await stockPrisma.stockAllocation.update({
    where: { id },
    // remarks omitted = keep the existing remarks
    data: { qty: needQty(input.qty), ...(input.remarks === undefined ? {} : { remarks: blankToNull(input.remarks) }) },
  });
  return toEntry(row);
}

export async function deleteBooking(id: string): Promise<void> {
  await stockPrisma.stockAllocation.delete({ where: { id } });
}

export async function lockOffer(input: {
  contractNo: string;
  itemCode: string;
  basis: Basis;
  remarks: string | null;
  rmCodes: { erpCode: string; location: string | null; qty: number }[];
}): Promise<LedgerEntry[]> {
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
  const rows = await stockPrisma.$transaction([
    stockPrisma.stockAllocation.deleteMany({ where: { contractNo, itemCode, source: "locked" } }),
    ...data.map((d) => stockPrisma.stockAllocation.create({ data: d })),
  ]);
  return rows.slice(1).map((r) => toEntry(r as Row));
}

export async function unlockOffer(contractNo: string, itemCode: string): Promise<void> {
  await stockPrisma.stockAllocation.deleteMany({
    where: { contractNo: need(contractNo, "Contract no"), itemCode: need(itemCode, "Item code"), source: "locked" },
  });
}
