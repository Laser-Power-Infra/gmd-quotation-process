"use server";

import { listStockEntries } from "@gmd/physical-stock/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { restoreEntry as restore, revertEntry as revert } from "@/app/actions";

// A "use server" file may only export async functions, so no re-exports.
export async function revertEntry(entryNo: string) {
  return revert(entryNo);
}

export async function restoreEntry(entryNo: string) {
  return restore(entryNo);
}

/** Entries of one ERP code, newest first. */
export async function loadEntries(erpCode: string) {
  if (!(await getCurrentUser())) return { success: false as const, error: "Unauthorized" };
  try {
    return { success: true as const, data: await listStockEntries(erpCode) };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
