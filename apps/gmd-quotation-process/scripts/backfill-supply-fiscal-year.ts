/**
 * One-off backfill — SALE BILL `ACC_YEAR` -> every blank
 * `SupplyHistoryItem.financialYear`, across all fiscal years.
 *
 *   pnpm --filter=gmd-quotation-process supply:fy                # dry run
 *   pnpm --filter=gmd-quotation-process supply:fy -- --limit=20  # sample
 *   pnpm --filter=gmd-quotation-process supply:fy:apply          # write
 *
 * A blank FY sits outside every job's scope filter, so those rows can never be
 * repaired by a normal sync. This fills the FY from the invoice row and never
 * touches a row that already has one.
 *
 * Env: `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` (or the hard-coded workbook) and
 * `SALE_BILL_GID`.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runSupplyYearBackfill } from "@/lib/supplyFiscalYearBackfill";

const USAGE = `
Supply History FINANCIAL YEAR backfill (SALE BILL ACC_YEAR -> blank FY, all years)

Usage:
  tsx scripts/backfill-supply-fiscal-year.ts [--apply] [--limit <n>]

Options:
  --apply      Write the fiscal years. Without it the run is a dry run.
  --limit <n>  Consider only the first n blank rows (smoke test).
  -h, --help   This message.
`.trim();

function parseArgs(argv: string[]) {
  let apply = false;
  let limit: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    switch (flag) {
      case "--apply":
        apply = true;
        break;
      case "--limit": {
        const value = inline ?? argv[++i];
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0) limit = parsed;
        else throw new Error(`--limit ${value} (expected a non-negative integer)`);
        break;
      }
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}\n\n${USAGE}`);
    }
  }

  return { apply, limit, help };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const result = await runSupplyYearBackfill({ apply: args.apply, limit: args.limit });

  if (!args.apply) {
    console.log("[backfill] dry run complete — no DB writes. Re-run with --apply to write.");
  } else if (result.failedWrites > 0) {
    console.log(`[backfill] finished with ${result.failedWrites} failed write(s) — see the log above.`);
    process.exitCode = 1;
  }
}

main()
  .catch(async (err) => {
    console.error(`\n[backfill] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
