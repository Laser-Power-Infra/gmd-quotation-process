import "server-only";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { allocationRows, lotRows, purchaseViewFacet, purchaseViewPage, type PurchaseViewKey, type PurchaseViewPage, type PurchaseViewRow } from "../purchaseView";
import type { InputsLoader } from "../types";
import { computeStockAllocation } from "./index";
import { listPurchaseAllocations } from "./purchaseLedger";

// Own file (exported as "@gmd/stock-allocation/server/purchase-view") so server/index.ts stays as it is.
// shortcut: runs the engine per page/facet like Ready to Bill does (see server/index.ts); share its per-request cache when that exists.

async function rowsOf(view: PurchaseViewKey, loadInputs?: InputsLoader): Promise<PurchaseViewRow[]> {
  const [result, allocs] = await Promise.all([computeStockAllocation(loadInputs), listPurchaseAllocations()]);
  const rows = allocs.map((a) => ({ ...a, allocatedAt: a.allocatedAt.toISOString() }));
  return view === "lots" ? lotRows(result.purchaseLines ?? [], rows) : allocationRows(rows, result.purchaseLines ?? []);
}

/** One page of the purchase allocations or the lot-wise (one row per purchase line) table, filtered, sorted and paged here. */
export async function listPurchaseViewPage(view: PurchaseViewKey, query: TableQuery, loadInputs?: InputsLoader): Promise<PurchaseViewPage> {
  return purchaseViewPage(view, await rowsOf(view, loadInputs), query);
}

export async function listPurchaseViewFacet(view: PurchaseViewKey, key: string, query: TableQuery, loadInputs?: InputsLoader): Promise<string[]> {
  return purchaseViewFacet(view, await rowsOf(view, loadInputs), key, query);
}
