"use server";

import {
  createPhysicalStock,
  listCodeOptions,
  listPhysicalStockFacet,
  listPhysicalStockPage,
  restoreStockEntry,
  revertStockEntry,
  updatePhysicalStockField,
  type StockTableQuery,
} from "@gmd/physical-stock/server";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { NewItemInput } from "@gmd/physical-stock/types";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import { getCurrentUser, isPrivileged } from "@/lib/auth-helpers";

// Auth is checked here too: proxy.ts does not protect Server Action endpoints.
// Flags are evaluated again inside every action: the UI hiding a control is
// cosmetic, these checks protect the data. No BOM ID picker here: its options
// need the quotation DB.

async function unauthorized() {
  return (await getCurrentUser()) ? null : { success: false as const, error: "Unauthorized" };
}

async function guarded<T>(fn: () => Promise<T>) {
  const denied = await unauthorized();
  if (denied) return denied;
  try {
    return { success: true as const, data: await fn() };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One filtered/sorted page; in-transit, heat and FG columns come from SQL. */
export async function loadPage(query: TableQuery) {
  return guarded(async () =>
    listPhysicalStockPage(query as StockTableQuery, { duplicates: (await getPhysicalStockFlags()).duplicateErpHighlight }),
  );
}

export async function loadFacet(field: string, query: TableQuery) {
  return guarded(() => listPhysicalStockFacet(field, query as StockTableQuery));
}

/** New Item picker codes; empty until the db-stock migration and first hourly sync. */
export async function loadCodeOptions() {
  return guarded(listCodeOptions);
}

export async function updateField(id: string, field: string, value: string | null) {
  const denied = await unauthorized();
  if (denied) return denied;
  return updatePhysicalStockField(id, field, value, editableFieldsFor(await getPhysicalStockFlags()));
}

/** Admin / developer only: takes an entry's quantity back out of stock. */
export async function revertEntry(entryNo: string) {
  if (!(await isPrivileged())) return { success: false as const, error: "Only an admin or developer can revert an entry." };
  return revertStockEntry(entryNo);
}

/** Admin / developer only: counts a reverted entry again. */
export async function restoreEntry(entryNo: string) {
  if (!(await isPrivileged())) return { success: false as const, error: "Only an admin or developer can restore an entry." };
  return restoreStockEntry(entryNo);
}

export async function create(input: NewItemInput) {
  const user = await getCurrentUser();
  if (!user) return { success: false as const, error: "Unauthorized" };
  if (!(await getPhysicalStockFlags()).newItem) {
    return { success: false as const, error: "Not allowed in this app." };
  }
  return createPhysicalStock(input, user.email ?? null);
}
