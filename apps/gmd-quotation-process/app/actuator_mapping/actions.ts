"use server";
import { requireAccess } from "@/lib/access";
import { listFacet, listPage } from "@gmd/actuator-mapping/server";
import type { PageData, ViewKey } from "@gmd/actuator-mapping/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";

// Actuator & Gearbox Mapping is read-only. Access is checked here: the package has no notion of this
// app's sessions. The package rejects an unknown view and any column key it does not list.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(view: ViewKey, query: TableQuery): Promise<Result<PageData>> {
  return guarded(async () => {
    await requireAccess();
    return listPage(view, query);
  });
}

export async function loadFacet(view: ViewKey, key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listFacet(view, key, query);
  });
}
