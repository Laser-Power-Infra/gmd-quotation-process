"use server";
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/access";
import { addBooking, computeStockAllocation, deleteBooking, lockOffer, unlockOffer, updateBooking } from "@gmd/stock-allocation/server";
import type { Basis } from "@gmd/stock-allocation/types";

type Res<T = null> = { success: true; data: T } | { success: false; error: string };

// Never throws to the client; every action below calls requireAccess() first.
async function run<T>(fn: () => Promise<T>, write = true): Promise<Res<T>> {
  try {
    const data = await fn();
    if (write) {
      revalidatePath("/stock_allocation");
      revalidatePath("/physical_stock");
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addBookingAction(input: Parameters<typeof addBooking>[0]) {
  return run(async () => { await requireAccess(); return addBooking(input); });
}
export async function updateBookingAction(id: string, input: { qty: number; remarks?: string | null }) {
  return run(async () => { await requireAccess(); return updateBooking(id, input); });
}
export async function deleteBookingAction(id: string) {
  return run(async () => { await requireAccess(); return deleteBooking(id); });
}
export async function setOfferSentAction(input: {
  contractNo: string; itemCode: string; sent: boolean; basis: Basis; remarks: string | null;
  rmCodes: { erpCode: string; location: string | null; qty: number }[];
}) {
  return run(async () => {
    await requireAccess();
    if (input.sent) await lockOffer(input);
    else await unlockOffer(input.contractNo, input.itemCode);
  });
}
export async function reloadAction() {
  return run(async () => { await requireAccess(); return computeStockAllocation(); }, false);
}
