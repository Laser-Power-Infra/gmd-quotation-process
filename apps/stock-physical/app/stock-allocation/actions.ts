"use server";

import { revalidatePath } from "next/cache";
import { addBooking, computeStockAllocation, deleteBooking, listAllocationLogPage, lockOffer, unlockOffer, updateBooking } from "@gmd/stock-allocation/server";
import type { StockAllocationActions } from "@gmd/stock-allocation/types";
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
  return run(() => computeStockAllocation(), false);
}
export async function loadLogPageAction(query: TableQuery) {
  return run(() => listAllocationLogPage(query), false);
}
