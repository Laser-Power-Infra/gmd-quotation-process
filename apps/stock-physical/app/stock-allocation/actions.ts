"use server";

import { revalidatePath } from "next/cache";
import { addBooking, addPurchaseAllocation, computeStockAllocation, deletePurchaseAllocation, updatePurchaseAllocation, deleteBooking, listAllocationLogPage, lockOffer, unlockOffer, updateBooking } from "@gmd/stock-allocation/server";
import type { StockAllocationActions } from "@gmd/stock-allocation/types";
import type { PurchaseViewKey } from "@gmd/stock-allocation/purchase-view";
import { listPurchaseViewFacet, listPurchaseViewPage } from "@gmd/stock-allocation/server/purchase-view";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
// `fn` gets who goes in the allocation log: the signed-in user's email (unique, it is the login), or their name if there is none.
async function run<T>(fn: (by: string | null) => Promise<T>, write = true) {
  const user = await getCurrentUser();
  if (!user) return { success: false as const, error: "Unauthorized" };
  try {
    const data = await fn(user.email || user.name || null);
    if (write) revalidatePath("/stock-allocation");
    return { success: true as const, data };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

type A = StockAllocationActions;

export async function addBookingAction(input: Parameters<A["addBookingAction"]>[0]) {
  return run((by) => addBooking(input, by));
}
export async function updateBookingAction(id: string, input: { qty: number; remarks?: string | null }) {
  return run((by) => updateBooking(id, input, by));
}
export async function deleteBookingAction(id: string) {
  return run((by) => deleteBooking(id, by));
}
export async function setOfferSentAction(input: Parameters<A["setOfferSentAction"]>[0]) {
  return run(async (by) => {
    if (input.sent) await lockOffer(input, by);
    else await unlockOffer(input.contractNo, input.itemCode, by);
  });
}
export async function reloadAction() {
  // lines[] (each line's purchase sources) and purchaseLines hold lot / invoice / B-L / ETA / PO no: the table reads neither, so they stay on the server
  return run(() => computeStockAllocation().then((r) => ({ ...r, lines: [], purchaseLines: [] })), false);
}
export async function loadLogPageAction(query: TableQuery) {
  return run(() => listAllocationLogPage(query), false);
}

export async function addPurchaseAllocationAction(input: Parameters<A["addPurchaseAllocationAction"]>[0]) {
  return run((by) => addPurchaseAllocation({ ...input, source: "manual" }, by).then(() => null));
}
export async function updatePurchaseAllocationAction(id: string, input: { qty: number; remarks?: string | null }) {
  return run((by) => updatePurchaseAllocation(id, input, by).then(() => null));
}
export async function deletePurchaseAllocationAction(id: string) {
  return run((by) => deletePurchaseAllocation(id, by));
}
// The two purchase tables are paged on the server; only their rows reach the browser.
export async function loadPurchaseViewPage(view: PurchaseViewKey, query: TableQuery) {
  return run(() => listPurchaseViewPage(view, query), false);
}
export async function loadPurchaseViewFacet(view: PurchaseViewKey, key: string, query: TableQuery) {
  return run(() => listPurchaseViewFacet(view, key, query), false);
}
