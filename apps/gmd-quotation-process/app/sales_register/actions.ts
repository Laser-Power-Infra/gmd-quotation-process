"use server";
import { requireAccess } from "@/lib/access";
import { listSalesFacet, listSalesPage, type SaleCostInput } from "@gmd/sales-register/server";
import type { SalesPageData } from "@gmd/sales-register/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { costLines, supplyCostInput } from "@/lib/lineCost-server";
import { minVaPercent } from "@/lib/vaRules";

// The Sales Register is read-only. Access is checked here: the package has no notion of this app's sessions.
// The cost of a line (BOM + GRN book across the quotation and stock DBs) and the minimum VA% are this app's
// rules, so the package hands its filtered lines to `costOf`.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function costOf(lines: SaleCostInput[]) {
  const costs = await costLines(lines.map(supplyCostInput));
  return lines.map((l, i) => ({
    unitCost: costs[i].unitCost,
    quotedUnitCost: costs[i].quotedUnitCost,
    minVa: minVaPercent({ itemType: l.valveType, size: l.size, itemName: l.itemName }),
  }));
}

export async function loadPage(query: TableQuery): Promise<Result<SalesPageData>> {
  return guarded(async () => {
    await requireAccess();
    return listSalesPage(query, costOf);
  });
}

export async function loadFacet(key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listSalesFacet(key, query);
  });
}
