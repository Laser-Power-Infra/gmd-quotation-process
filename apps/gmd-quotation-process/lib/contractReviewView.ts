import "server-only";
import {
  listContractReviewAllRows,
  listContractReviewFacet,
  listContractReviewPage,
  type ContractReviewLookups,
} from "@gmd/contract-review/server";
import type {
  ContractReviewViewQuery,
  ContractReviewViewResult,
} from "@gmd/contract-review/types";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { normalizeContractKey } from "@/lib/gmd_lib/contract-review-enquiry-backfill";
import { getContractReviewImagesByItemCode } from "@/lib/gmd_lib/contract-review-image-lookup";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";

// Contract Review is filtered, sorted, paged and aggregated in SQL on the tender
// DB (@gmd/contract-review/server). This app adds what only the quotation DB
// knows: BOM ids and item images per item code.

const lookups: ContractReviewLookups = {
  bomIds: getBatchDistinctBomIds,
  // Images resolve through a normalized code; key them by the raw item code the rows carry.
  async images(itemCodes) {
    const byNormalized = await getContractReviewImagesByItemCode(itemCodes);
    const out: Awaited<ReturnType<ContractReviewLookups["images"]>> = {};
    for (const code of itemCodes) {
      const matches = byNormalized.get(normalizeContractKey(code)) ?? [];
      if (matches.length) out[code] = matches;
    }
    return out;
  },
};

const options = async () => ({ flags: await getContractReviewFlags(), lookups });

export async function buildContractReviewView(
  query: ContractReviewViewQuery,
): Promise<ContractReviewViewResult> {
  const t0 = performance.now();
  const result = await listContractReviewPage(query, await options());
  if (process.env.CR_TIMING) {
    console.log(`[contract-review view] ${(performance.now() - t0).toFixed(0)}ms, rows ${result.total}, page ${result.page}`);
  }
  return result;
}

export async function buildContractReviewFacet(
  query: ContractReviewViewQuery,
  header: string,
): Promise<string[]> {
  return listContractReviewFacet(query, header, await options());
}

export async function buildContractReviewAllRows(
  query: ContractReviewViewQuery,
): Promise<unknown[][]> {
  return listContractReviewAllRows(query, await options());
}
