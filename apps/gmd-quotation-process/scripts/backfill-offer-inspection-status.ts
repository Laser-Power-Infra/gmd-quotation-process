/**
 * One-off: recompute OFFER PENDING/DONE and Inspection for every ContractReview row.
 *
 * Runs the same two functions the hourly contract-review job runs in step 7, so
 * the rule lives in one place (@gmd/contract-review/server):
 *   offerPendingDone = DONE iff itemCode + mcNo + offerNumber are set
 *   inspection       = DONE iff offerNumber + inspectionNumber are set
 * Only rows whose stored value disagrees with the rule are written. Idempotent.
 *
 * Usage (from apps/gmd-quotation-process):
 *   npm run cr:status:backfill
 */

import "dotenv/config";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { backfillInspection, backfillOfferPendingDone } from "@gmd/contract-review/server";

async function main() {
  const ids = (await tenderPrisma.contractReview.findMany({ select: { id: true } })).map((r) => r.id);
  console.log(`ContractReview rows: ${ids.length}`);

  let failed = false;
  for (const [label, run] of [
    ["OFFER PENDING/DONE", backfillOfferPendingDone],
    ["Inspection", backfillInspection],
  ] as const) {
    const res = await run(ids);
    if (res.success) console.log(`${label}: ${(res.data as unknown[]).length} row(s) updated`);
    else {
      failed = true;
      console.error(`${label}: FAILED - ${res.error} (re-run to retry)`);
    }
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => tenderPrisma.$disconnect());
