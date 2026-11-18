"use server";
import { requireAccess } from "@/lib/access";
import { getContractDetail, listOrderStatusExport, listOrderStatusFacet, listOrderStatusPage } from "@gmd/order-status/server";
import type { ContractDetail, OrderStatusPageData } from "@gmd/order-status/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";

// Order Status is read-only. Access is checked here: the package has no notion of this app's sessions.
// The package accepts only the column keys it lists.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(query: TableQuery): Promise<Result<OrderStatusPageData>> {
  return guarded(async () => {
    await requireAccess();
    return listOrderStatusPage(query);
  });
}

export async function loadFacet(key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listOrderStatusFacet(key, query);
  });
}

/** Paper-trail drill-down: the contract's lines and the invoices raised against it. */
export async function loadContract(contractNo: string): Promise<Result<ContractDetail>> {
  return guarded(async () => {
    await requireAccess();
    if (typeof contractNo !== "string" || !contractNo.trim()) throw new Error("Contract number is required.");
    return getContractDetail(contractNo);
  });
}

export async function loadExport(query: TableQuery): Promise<Result<(string | number | null)[][]>> {
  return guarded(async () => {
    await requireAccess();
    return listOrderStatusExport(query);
  });
}
