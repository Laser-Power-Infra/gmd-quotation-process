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

// Contract review in this app is public (no auth), as for ./actions.

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

/** One filtered, sorted page plus the sidebar / flow-diagram aggregates. */
export async function loadView(
  query: ContractReviewViewQuery,
): Promise<ActionResult<ContractReviewViewResult>> {
  await requireAccess();
  try {
    return { success: true, data: await buildContractReviewView(query) };
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
