"use server";
import { requireAccess } from "@/lib/access";
import { getPendingDocketsScope } from "@/lib/pendingDocketsScope";
import { getPendingThread, listPendingDocketsFacet, listPendingDocketsPage } from "@gmd/pending-dockets/server";
import type { PendingDocketsPage, PendingThread } from "@gmd/pending-dockets/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";

// Pending Dockets tab (read-only). Access is checked here: the package has no notion of this app's
// sessions. The package ignores any column key it does not list.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(query: TableQuery): Promise<Result<PendingDocketsPage>> {
  return guarded(async () => {
    await requireAccess();
    return listPendingDocketsPage(await getPendingDocketsScope(), query);
  });
}

export async function loadFacet(key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listPendingDocketsFacet(await getPendingDocketsScope(), key, query);
  });
}

export async function loadThread(id: string): Promise<Result<PendingThread>> {
  return guarded(async () => {
    await requireAccess();
    const threadId = Number(id);
    if (!Number.isSafeInteger(threadId) || threadId <= 0) throw new Error("Unknown mail thread.");
    const thread = await getPendingThread(threadId);
    if (!thread) throw new Error("This mail thread no longer exists.");
    return thread;
  });
}
