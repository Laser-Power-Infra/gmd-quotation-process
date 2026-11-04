"use server";

import { addHeatEntries, deletePendingHeatEntry, findHeatItem, listHeatQueue, setHeatDone, updateHeatDims } from "@gmd/physical-stock/server";
import type { HeatDims } from "@gmd/physical-stock/types";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here: proxy.ts does not protect Server Action endpoints.
// The sheet upload is a route handler (api/heat-sheet): Server Actions cap the
// body at 1 MB and a photo is bigger.

const denied = async () => ((await getCurrentUser()) ? null : { success: false as const, error: "Unauthorized" });

export async function queue() {
  const d = await denied();
  if (d) return d;
  return { success: true as const, data: await listHeatQueue() };
}

export async function findByCode(erpCode: string) {
  const d = await denied();
  if (d) return d;
  return { success: true as const, data: await findHeatItem(erpCode) };
}

export async function saveDims(entryId: string, dims: HeatDims) {
  return (await denied()) ?? updateHeatDims(entryId, dims);
}

export async function addHeats(stockId: string, heatNos: string[]) {
  return (await denied()) ?? addHeatEntries(stockId, heatNos);
}

export async function cancelHeat(entryId: string) {
  return (await denied()) ?? deletePendingHeatEntry(entryId);
}

export async function done(stockId: string) {
  return (await denied()) ?? setHeatDone(stockId);
}
