"use server";
import { requireAccess } from "@/lib/access";
import { listReadyToBillFacet, listReadyToBillPage } from "@gmd/stock-allocation/server";
import type { TableQuery } from "@gmd/ui/components/data-table/types";

// Ready to Bill is read-only. Access is checked here: the package has no notion of this app's sessions.

type Res<T> = { success: true; data: T } | { success: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Res<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(query: TableQuery) {
  return run(async () => { await requireAccess(); return listReadyToBillPage(query); });
}

export async function loadFacet(key: string, query: TableQuery) {
  return run(async () => { await requireAccess(); return listReadyToBillFacet(key, query); });
}
