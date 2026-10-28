/**
 * Manual AI verification backfill for the Pending Dockets tab.
 *
 * Targets threads that are already flagged as pending dockets and have never
 * been decided (`aiIsNewDocket = null`). Each thread is attempted at most 3
 * times by the runner; a true/false verdict is final. Dry run by default.
 *
 * Usage:
 *   npx tsx scripts/backfill-docket-ai-validation.ts
 *   npx tsx scripts/backfill-docket-ai-validation.ts --apply
 *   npx tsx scripts/backfill-docket-ai-validation.ts --apply --limit=50
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isPendingDocketCandidate } from "@/lib/docketPending";
import {
  isDocketAiEligible,
  runDocketAiValidation,
  type DocketAiThreadInput,
} from "@/lib/docketAiValidationRunner";
import { isDocketAiValidationEnabled } from "@/lib/docketAiValidator";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 100) : 100;
const BATCH_SIZE = 500;

async function main() {
  console.log(
    `AI docket verification — ${APPLY ? "APPLY" : "DRY RUN"} (limit ${LIMIT})`,
  );
  if (!isDocketAiValidationEnabled()) {
    console.log(
      "DOCKET_AI_API_KEY is not set (or DOCKET_AI_VALIDATION_ENABLED=false). " +
        "Set the dedicated key before running with --apply.",
    );
  }

  const candidates: DocketAiThreadInput[] = [];
  let scanned = 0;
  let cursor = 0;

  while (candidates.length < LIMIT) {
    const batch = await prisma.docketQuotationThread.findMany({
      where: {
        pendingDocket: true,
        aiIsNewDocket: null,
        docketNo: null,
        duplicateOfDocket: null,
      },
      orderBy: { date: "desc" },
      take: BATCH_SIZE,
      skip: cursor,
      select: {
        id: true,
        subject: true,
        body: true,
        bodyPreview: true,
        ocrText: true,
        sender: true,
        toDetails: true,
        ccDetails: true,
        company: true,
        isGmdClient: true,
        userLabels: true,
        docketNo: true,
        duplicateOfDocket: true,
        aiIsNewDocket: true,
        aiValidationAttempts: true,
      },
    });

    if (batch.length === 0) break;
    cursor += batch.length;
    scanned += batch.length;

    for (const t of batch) {
      const text = `${t.subject || ""} ${t.body || ""} ${t.bodyPreview || ""}`;
      const isCandidate = isPendingDocketCandidate({
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
        text,
      });
      if (!isCandidate) continue;

      const input: DocketAiThreadInput = {
        id: t.id,
        subject: t.subject,
        body: t.body,
        bodyPreview: t.bodyPreview,
        ocrText: t.ocrText,
        docketNo: t.docketNo,
        duplicateOfDocket: t.duplicateOfDocket,
        aiIsNewDocket: t.aiIsNewDocket,
        aiValidationAttempts: t.aiValidationAttempts,
        userLabels: t.userLabels,
        isGmdClient: t.isGmdClient,
        company: t.company,
        toDetails: t.toDetails,
        ccDetails: t.ccDetails,
      };
      if (!isDocketAiEligible(input)) continue;

      candidates.push(input);
      if (candidates.length >= LIMIT) break;
    }
  }

  console.log(`Scanned ${scanned} pending threads.`);
  console.log(`Eligible pending-docket candidates: ${candidates.length}`);

  if (candidates.length === 0) return;

  if (!APPLY) {
    console.log("\nSample candidates:");
    candidates.slice(0, 20).forEach((c) => {
      console.log(`  ${c.id} | ${(c.subject || "No Subject").slice(0, 70)}`);
    });
    console.log("\nDRY RUN - re-run with --apply to call the model and store verdicts.");
    return;
  }

  const result = await runDocketAiValidation(candidates, { limit: LIMIT });

  console.log(
    `\nAPPLIED: attempted=${result.attempted} true=${result.verifiedTrue} ` +
      `false=${result.verifiedFalse} skipped=${result.skipped} errors=${result.errors}`,
  );
  if (result.errors > 0) {
    console.log(
      "Threads with errors keep a null verdict and an incremented attempt count. " +
        "They retry on the next trigger until 3 attempts, then stay 'Not verified'.",
    );
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
