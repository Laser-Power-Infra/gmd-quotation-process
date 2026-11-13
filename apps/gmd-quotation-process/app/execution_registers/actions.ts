"use server";
import { requireAccess } from "@/lib/access";
import { listRegisterFacet, listRegisterPage } from "@gmd/execution-registers/server";
import type { RegisterKey, RegisterPageData } from "@gmd/execution-registers/columns";
import type { TableQuery } from "@gmd/ui/components/data-table/types";

// Execution Registers are read-only. Access is checked here: the package has no notion of this
// app's sessions. The package rejects an unknown register and any column key it does not list.

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadPage(register: RegisterKey, query: TableQuery): Promise<Result<RegisterPageData>> {
  return guarded(async () => {
    await requireAccess();
    return listRegisterPage(register, query);
  });
}

export async function loadFacet(register: RegisterKey, key: string, query: TableQuery): Promise<Result<string[]>> {
  return guarded(async () => {
    await requireAccess();
    return listRegisterFacet(register, key, query);
  });
}
