import { stockPrisma } from "@gmd/db-stock";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { parseQty } from "@gmd/purchase/in-transit";
import { logRow } from "../allocationLog";
import { checkCapacity } from "../purchaseAllocation";
import { friendlyPurchaseError } from "../purchaseView";

export type PurchaseAllocationRow = Awaited<ReturnType<typeof stockPrisma.purchaseAllocation.findFirstOrThrow>>;

export interface PurchaseAllocationInput {
  poNo: string; poLineNo: string; contractNo: string; itemCode: string; qty: number;
  lot?: string | null; tinaInvoiceNo?: string | null; blNo?: string | null; eta?: string | null; shipStatus?: string | null;
  needsConfirmation?: boolean; remarks?: string | null; source: "sheet" | "manual";
}

type Tx = Parameters<Parameters<typeof stockPrisma.$transaction>[0]>[0];

const need = (v: string | null | undefined, label: string) => {
  const s = (v ?? "").trim();
  if (!s) throw new Error(`${label} is required`);
  return s;
};
const needQty = (q: number) => {
  if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be greater than 0");
  return q;
};
const blankToNull = (v: string | null | undefined) => (v ?? "").trim() || null;

/** A second allocation for the same purchase line + contract + item (the unique key). */
export class DuplicatePurchaseAllocationError extends Error {
  constructor() { super("This contract line is already allocated from this purchase line: edit its qty instead"); this.name = "DuplicatePurchaseAllocationError"; }
}

// Ordered qty and the other allocations are read inside the write's transaction, after a per-purchase-line advisory lock
// (held to commit), so two writers on the same line queue up instead of both passing the check at READ COMMITTED.
async function guard(tx: Tx, poNo: string, poLineNo: string, adding: number, exceptId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${poNo}|${poLineNo}`}))`;
  const line = await tx.purchaseOrderLine.findFirst({ where: { poNo, poLineNo }, select: { netQtyOrder: true, itemCode: true } });
  if (!line) throw new Error(`purchase line PO ${poNo}/${poLineNo} not found`);
  const sum = await tx.purchaseAllocation.aggregate({
    where: { poNo, poLineNo, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { qty: true },
  });
  const err = checkCapacity(parseQty(line.netQtyOrder), sum._sum.qty ?? 0, adding);
  if (err) throw new Error(`PO ${poNo}/${poLineNo}: ${err}`);
  return line.itemCode ?? "";
}

// Logged as a manual booking (book/change/remove): erpCode = purchase line item code, note = PO/line.
const log = (tx: Tx, by: string | null, erpCode: string, before: PurchaseAllocationRow | null, after: PurchaseAllocationRow | null) => {
  const side = (x: PurchaseAllocationRow | null) =>
    x && { contractNo: x.contractNo, itemCode: x.itemCode, erpCode, location: null, qty: x.qty, source: "manual", remarks: `PO ${x.poNo}/${x.poLineNo}` };
  return tx.stockAllocationLog.create({ data: logRow(by, side(before), side(after)) });
};

const TX = { timeout: 120_000 }; // Prisma's 5 s default risks P2028

export async function listPurchaseAllocations(): Promise<PurchaseAllocationRow[]> {
  return stockPrisma.purchaseAllocation.findMany({ orderBy: { allocatedAt: "asc" } });
}

export async function addPurchaseAllocation(input: PurchaseAllocationInput, by: string | null): Promise<PurchaseAllocationRow> {
  const poNo = need(input.poNo, "PO no");
  const poLineNo = need(input.poLineNo, "PO line no");
  const qty = needQty(input.qty);
  const data = {
    poNo, poLineNo, qty,
    contractNo: need(input.contractNo, "Contract no"),
    itemCode: need(input.itemCode, "Item code"),
    lot: blankToNull(input.lot), tinaInvoiceNo: blankToNull(input.tinaInvoiceNo), blNo: blankToNull(input.blNo),
    eta: blankToNull(input.eta), shipStatus: blankToNull(input.shipStatus),
    needsConfirmation: input.needsConfirmation ?? false, remarks: blankToNull(input.remarks), source: input.source,
  };
  // same live definition as computeStockAllocation: a typo or a closed line would otherwise eat the purchase line's capacity
  const live = await tenderPrisma.contractReview.findFirst({
    where: {
      contractNo: { equals: data.contractNo, mode: "insensitive" }, itemCode: { equals: data.itemCode, mode: "insensitive" },
      OR: [{ status: null }, { status: "" }], clearanceStatus: "APPROVED",
      mcReceivedPending: { in: ["Received", "Pending"], mode: "insensitive" },
    },
    select: { id: true },
  });
  if (!live) throw new Error(`No live contract line ${data.contractNo} / ${data.itemCode}`);
  return stockPrisma.$transaction(async (tx) => {
    const erpCode = await guard(tx, poNo, poLineNo, qty);
    const row = await tx.purchaseAllocation.create({ data });
    await log(tx, by, erpCode, null, row);
    return row;
  }, TX).catch((err) => { // P2002 on poNo+poLineNo+contractNo+itemCode
    if ((err as { code?: unknown } | null)?.code === "P2002") throw new DuplicatePurchaseAllocationError();
    throw friendlyPurchaseError(err);
  });
}

export async function updatePurchaseAllocation(
  id: string,
  input: { qty: number; remarks?: string | null },
  by: string | null,
): Promise<PurchaseAllocationRow> {
  const qty = needQty(input.qty);
  return stockPrisma.$transaction(async (tx) => {
    const before = await tx.purchaseAllocation.findUniqueOrThrow({ where: { id } });
    const erpCode = await guard(tx, before.poNo, before.poLineNo, qty, id);
    // remarks omitted = keep the existing remarks
    const row = await tx.purchaseAllocation.update({
      where: { id },
      data: { qty, ...(input.remarks === undefined ? {} : { remarks: blankToNull(input.remarks) }) },
    });
    await log(tx, by, erpCode, before, row);
    return row;
  }, TX);
}

export async function deletePurchaseAllocation(id: string, by: string | null): Promise<void> {
  await stockPrisma.$transaction(async (tx) => {
    const before = await tx.purchaseAllocation.findUniqueOrThrow({ where: { id } });
    const line = await tx.purchaseOrderLine.findFirst({ where: { poNo: before.poNo, poLineNo: before.poLineNo }, select: { itemCode: true } });
    await tx.purchaseAllocation.delete({ where: { id } });
    await log(tx, by, line?.itemCode ?? "", before, null);
  }, TX);
}
