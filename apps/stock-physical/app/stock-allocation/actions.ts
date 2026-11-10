"use server";

import { revalidatePath } from "next/cache";
import { addBooking, computeStockAllocation, deleteBooking, lockOffer, unlockOffer, updateBooking } from "@gmd/stock-allocation/server";
import type { StockAllocationActions } from "@gmd/stock-allocation/types";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
async function run<T>(fn: () => Promise<T>, write = true) {
  if (!(await getCurrentUser())) return { success: false as const, error: "Unauthorized" };
  try {
    const data = await fn();
    if (write) revalidatePath("/stock-allocation");
    return { success: true as const, data };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

type A = StockAllocationActions;

export async function addBookingAction(input: Parameters<A["addBookingAction"]>[0]) {
  return run(() => addBooking(input));
}
export async function updateBookingAction(id: string, input: { qty: number; remarks?: string | null }) {
  return run(() => updateBooking(id, input));
}
export async function deleteBookingAction(id: string) {
  return run(() => deleteBooking(id));
}
export async function setOfferSentAction(input: Parameters<A["setOfferSentAction"]>[0]) {
  return run(async () => {
    if (input.sent) await lockOffer(input);
    else await unlockOffer(input.contractNo, input.itemCode);
  });
}
export async function reloadAction() {
  return run(computeStockAllocation, false);
}
