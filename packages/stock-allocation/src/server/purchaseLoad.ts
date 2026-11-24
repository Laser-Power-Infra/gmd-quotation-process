import { stockPrisma } from "@gmd/db-stock";
import { parseQty } from "@gmd/purchase/in-transit";
import { buildPurchaseInputs } from "../purchaseAllocation";
import { listPurchaseAllocations } from "./purchaseLedger";

const CHUNK = 500; // OR terms per query

/**
 * Purchase lines that carry allocations (closed ones too: short receipt needs them) plus every line with pending qty,
 * split into engine inputs. `isLive` says whether an allocation's contract line is still live. Empty when the tables
 * are not deployed yet.
 */
export async function loadPurchase(isLive: (a: { contractNo: string; itemCode: string }) => boolean): Promise<ReturnType<typeof buildPurchaseInputs>> {
  try {
    const allocs = await listPurchaseAllocations();
    const claimed = allocs.map((a) => ({ poNo: a.poNo, poLineNo: a.poLineNo }));
    const open = { inTransit: { gt: 0 }, itemCode: { not: null } };
    // one query; chunked only when the allocation list is very large
    const terms: object[][] = [];
    for (let i = 0; i < claimed.length || !terms.length; i += CHUNK) terms.push(claimed.slice(i, i + CHUNK));
    const found = await Promise.all(terms.map((c, i) => stockPrisma.purchaseOrderLine.findMany({
      where: { OR: i === 0 ? [open, ...c] : c },
      select: { poNo: true, poLineNo: true, itemCode: true, netQtyOrder: true, qtyExecuted: true, balanceQty: true, deliverySched: true },
      orderBy: [{ poNo: "asc" }, { poLineNo: "asc" }],
    })));
    const byKey = new Map(found.flat().map((p) => [`${p.poNo}|${p.poLineNo}`, p]));
    const lines = [...byKey.values()].map((p) => {
      const balance = parseQty(p.balanceQty);
      return {
        poNo: p.poNo, poLineNo: p.poLineNo, itemCode: p.itemCode ?? "", ordered: parseQty(p.netQtyOrder) ?? 0,
        received: parseQty(p.qtyExecuted) ?? 0, closed: balance !== null && balance <= 0, eta: p.deliverySched?.trim() || null,
      };
    });
    return buildPurchaseInputs(lines, allocs.map((a) => ({ ...a, allocatedAt: a.allocatedAt.toISOString() })), isLive);
  } catch (err) {
    // table not deployed yet (P2021) is the quiet case; anything else is a real failure that must be visible
    if ((err as { code?: unknown } | null)?.code !== "P2021") console.error("[stock-allocation] purchase allocations read failed", err);
    return { purchaseAllocations: [], incoming: [], views: [] };
  }
}
