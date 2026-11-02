"use server";

import {
  addHeatEntry,
  deletePendingHeatEntry,
  listHeatCategories,
  listHeatQueue,
  setHeatDone,
} from "@gmd/physical-stock/server";
import { getCurrentUser } from "@/lib/auth-helpers";

// Auth is checked here: proxy.ts does not protect Server Action endpoints.
// The sheet upload is a route handler (api/heat-sheet): Server Actions cap the
// body at 1 MB and a phone photo is bigger.

const denied = async () => ((await getCurrentUser()) ? null : { success: false as const, error: "Unauthorized" });

export async function categories() {
  const d = await denied();
  if (d) return d;
  return { success: true as const, data: await listHeatCategories() };
}

export async function queue(category: string) {
  const d = await denied();
  if (d) return d;
  return { success: true as const, data: await listHeatQueue(category) };
}

export async function addHeat(stockId: string, heatNo: string) {
  return (await denied()) ?? addHeatEntry(stockId, heatNo);
}

export async function cancelHeat(entryId: string) {
  return (await denied()) ?? deletePendingHeatEntry(entryId);
}

export async function done(stockId: string) {
  return (await denied()) ?? setHeatDone(stockId);
}
