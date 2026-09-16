import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  computeContractReviewEnquiryBackfill,
  applyContractReviewEnquiryBackfill,
} from "../lib/gmd_lib/contract-review-enquiry-backfill";

const APPLY = process.argv.includes("--apply");

function show(value: string | null | undefined): string {
  if (value === null || value === undefined) return "<null>";
  if (value === "") return "<blank>";
  return value;
}

function short(value: string | null | undefined, max = 30): string {
  const s = show(value);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function main() {
  console.log(
    `\n=== BACKFILL CONTRACT REVIEW STATE / UTILITY / PROJECT REFERENCE [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`,
  );

  const result = await computeContractReviewEnquiryBackfill(prisma);

  console.log("--- PREVIEW: CONTRACT NO | STATE | UTILITY | PROJECT REFERENCE ---");
  for (const row of result.rows) {
    console.log(
      `[CHANGE] ${short(row.contractNo, 28).padEnd(28)} | ` +
        `${short(row.previous.state, 18).padStart(18)} -> ${short(row.state, 18).padEnd(18)} | ` +
        `${short(row.previous.utility, 16).padStart(16)} -> ${short(row.utility, 16).padEnd(16)} | ` +
        `${short(row.previous.projectReference, 20).padStart(20)} -> ${short(row.projectReference, 20)}`,
    );
  }

  console.log("\n--- SUMMARY ---");
  console.log(`Matched review rows:   ${result.matched}`);
  console.log(`Rows to change:        ${result.changed}`);
  console.log(`Rows already up to date: ${result.matched - result.changed}`);
  console.log(`Review rows unmatched: ${result.unmatched}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write state / utility / projectReference.\n");
    return;
  }

  const updated = await applyContractReviewEnquiryBackfill(prisma, result.rows);
  console.log(
    `\nApplied. Updated ${updated} ContractReview row(s) (state / utility / projectReference only).\n`,
  );
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
