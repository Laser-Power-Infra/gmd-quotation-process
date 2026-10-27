"use server";
import { requireAccess } from "@/lib/access";

import type {
  ActionResult,
  ContractReviewViewQuery,
  ContractReviewViewResult,
} from "@gmd/contract-review/types";
import {
  buildContractReviewAllRows,
  buildContractReviewFacet,
  buildContractReviewView,
} from "@/lib/contractReviewView";
import { runContractReviewBackfills } from "@/lib/contractReviewBackfill";

// Contract review in this app is public (no auth), as for ./actions.

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

/** One filtered, sorted page plus the sidebar / flow-diagram aggregates. */
export async function loadView(
  query: ContractReviewViewQuery,
  opts?: { fresh?: boolean },
): Promise<ActionResult<ContractReviewViewResult>> {
  await requireAccess();
  try {
    return { success: true, data: await buildContractReviewView(query, !!opts?.fresh) };
  } catch (error) {
    console.error("Error loading contract review view:", error);
    return { success: false, error: errorMessage(error) };
  }
}

export async function loadFacet(
  query: ContractReviewViewQuery,
  header: string,
): Promise<ActionResult<string[]>> {
  await requireAccess();
  try {
    return { success: true, data: await buildContractReviewFacet(query, header) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Every row matching the filters, for the Excel export. */
export async function loadAllRows(
  query: ContractReviewViewQuery,
): Promise<ActionResult<unknown[][]>> {
  await requireAccess();
  try {
    return { success: true, data: await buildContractReviewAllRows(query) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Kept for callers that use the action; the page itself calls the route handler so it isn't queued behind view requests. */
export async function runBackfillsAction(): Promise<ActionResult> {
  await requireAccess();
  return runContractReviewBackfills();
}
