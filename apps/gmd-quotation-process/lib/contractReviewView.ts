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
import { computeStockAllocation } from "@gmd/stock-allocation/server";
import type { LineAllocation } from "@gmd/stock-allocation/types";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { normalizeContractKey } from "@/lib/gmd_lib/contract-review-enquiry-backfill";
import { getContractReviewImagesByItemCode } from "@/lib/gmd_lib/contract-review-image-lookup";
import { stockAllocationInputs } from "@/lib/stockAllocationInputs";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";

// Contract Review is filtered, sorted, paged and aggregated in SQL on the tender
// DB (@gmd/contract-review/server). This app adds what only the quotation DB
// knows: BOM ids and item images per item code, and each line's stock allocation.

// shortcut: one engine run (whole live order book + all physical stock) serves every page load for 30 s per server process, so a booking or an edit shows here up to 30 s late; drop it if the engine gets a cheaper per-request path.
const ALLOCATION_TTL_MS = 30_000;
let allocationCache: { at: number; lines: Promise<LineAllocation[]> } | null = null;

/** The engine's lines, cached like the actuator master: concurrent page loads share one run, a failed run is retried next call. */
function allocationLines(): Promise<LineAllocation[]> {
  if (allocationCache && Date.now() - allocationCache.at < ALLOCATION_TTL_MS) return allocationCache.lines;
  const lines = computeStockAllocation(stockAllocationInputs).then((r) => r.lines);
  allocationCache = { at: Date.now(), lines };
  lines.catch(() => { if (allocationCache?.lines === lines) allocationCache = null; });
  return lines;
}

/** Drop the cached engine run: call after any write that can change an allocation, so the next page load recomputes. */
export function invalidateContractReviewAllocation() {
  allocationCache = null;
}

/** Stock allocation of the page's lines, by Contract Review line id. A failed engine run leaves the cells blank instead of failing the page. */
export async function contractReviewAllocation(ids: string[]): Promise<Map<string, LineAllocation>> {
  const wanted = new Set(ids);
  const lines = await allocationLines().catch((err): LineAllocation[] => {
    console.error("[contract-review] stock allocation failed", err);
    return [];
  });
  return new Map(lines.filter((l) => wanted.has(l.id)).map((l) => [l.id, l]));
}

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
  allocation: contractReviewAllocation,
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
