"use server";

import {
  BLANK_STATUS_SCOPE,
  listContractReviewAllRows,
  listContractReviewFacet,
  listContractReviewPage,
} from "@gmd/contract-review/server";
import type {
  ActionResult,
  ContractReviewViewQuery,
  ContractReviewViewResult,
} from "@gmd/contract-review/types";
import { requireUser, withLog } from "@/lib/activity-logger";
import { getContractReviewFlags } from "@/lib/contract-review-flags";

// Server view of Contract Review: one filtered, sorted page plus the sidebar
// aggregates, computed in SQL. Tender only sees rows with a blank STATUS, and
// never reads the quotation DB (no BOM / image lookups).

const options = async () => ({ flags: await getContractReviewFlags(), scope: BLANK_STATUS_SCOPE });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error");

async function guarded<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  await requireUser();
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    console.error("Error loading contract review:", error);
    return { success: false, error: errorMessage(error) };
  }
}

// Reads are not written to the activity log.
const noLog = () => null;

export const loadView = withLog(
  (query: ContractReviewViewQuery): Promise<ActionResult<ContractReviewViewResult>> =>
    guarded(async () => listContractReviewPage(query, await options())),
  noLog,
);

export const loadFacet = withLog(
  (query: ContractReviewViewQuery, header: string): Promise<ActionResult<string[]>> =>
    guarded(async () => listContractReviewFacet(query, header, await options())),
  noLog,
);

/** Every row matching the filters, for the Excel export. */
export const loadAllRows = withLog(
  (query: ContractReviewViewQuery): Promise<ActionResult<unknown[][]>> =>
    guarded(async () => listContractReviewAllRows(query, await options())),
  noLog,
);
