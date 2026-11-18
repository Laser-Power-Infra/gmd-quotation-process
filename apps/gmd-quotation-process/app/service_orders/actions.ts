"use server";
import { requireAccess } from "@/lib/access";
import { listServiceOrderFacet, listServiceOrderPage } from "@gmd/service-orders/server";
import type { ServiceOrdersPageData, ServiceOrdersQuery } from "@gmd/service-orders/columns";

// Service / Work Orders are read-only. Access is checked here: the package has no notion of this
// app's sessions. The package rejects any column key it does not list.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(query: ServiceOrdersQuery): Promise<Result<ServiceOrdersPageData>> {
  return guarded(async () => {
    await requireAccess();
    return listServiceOrderPage(query);
  });
}

export async function loadFacet(key: string, query: ServiceOrdersQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listServiceOrderFacet(key, query);
  });
}
