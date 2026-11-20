"use server";
import { revalidatePath } from "next/cache";
import { loginRequired, requireAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth-helpers";
import { addBooking, computeStockAllocation, deleteBooking, listAllocationLogPage, lockOffer, unlockOffer, updateBooking } from "@gmd/stock-allocation/server";
import type { Basis } from "@gmd/stock-allocation/types";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { invalidateContractReviewAllocation } from "@/lib/contractReviewView";
import { stockAllocationInputs } from "@/lib/stockAllocationInputs";

type Res<T = null> = { success: true; data: T } | { success: false; error: string };

// Never throws to the client; every action below calls requireAccess() inside it.
async function run<T>(fn: () => Promise<T>, write = true): Promise<Res<T>> {
  try {
    const data = await fn();
    if (write) {
      revalidatePath("/stock_allocation");
      revalidatePath("/physical_stock");
      invalidateContractReviewAllocation();
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Who goes in the allocation log: the signed-in user's email (unique, it is the login), or their name if there is none. */
async function who() {
  const u = await getCurrentUser();
  return (u?.email || u?.name) ?? null;
}

// Writes need a login on every server, as Dashboard edits do, so the allocation log always knows who. Viewing stays open.
export async function addBookingAction(input: Parameters<typeof addBooking>[0]) {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => { await requireAccess(); return addBooking(input, await who()); });
}
export async function updateBookingAction(id: string, input: { qty: number; remarks?: string | null }) {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => { await requireAccess(); return updateBooking(id, input, await who()); });
}
export async function deleteBookingAction(id: string) {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => { await requireAccess(); return deleteBooking(id, await who()); });
}
export async function setOfferSentAction(input: {
  contractNo: string; itemCode: string; sent: boolean; basis: Basis; remarks: string | null;
  rmCodes: { erpCode: string; location: string | null; qty: number }[];
}) {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => {
    await requireAccess();
    const by = await who();
    if (input.sent) await lockOffer(input, by);
    else await unlockOffer(input.contractNo, input.itemCode, by);
  });
}
export async function reloadAction() {
  // lines[] is for Contract Review / Ready to Bill; the Stock Allocation table does not read it (as on the page)
  return run(async () => { await requireAccess(); return computeStockAllocation(stockAllocationInputs).then((r) => ({ ...r, lines: [] })); }, false);
}
export async function loadLogPageAction(query: TableQuery) {
  return run(async () => { await requireAccess(); return listAllocationLogPage(query); }, false);
}
