/**
 * One-off overwrite — SALE BILL `RATE` -> `SupplyHistoryItem.rate`, then
 * `value = quantity x rate` and `grossTotalInvoiceValue = value x 1.18` for
 * every row, replacing whatever the MASTER sync wrote.
 *
 *   pnpm --filter=gmd-quotation-process supply:rate-value                # dry run
 *   pnpm --filter=gmd-quotation-process supply:rate-value -- --limit=20  # sample
 *   pnpm --filter=gmd-quotation-process supply:rate-value:apply          # write
 *
 * Rows the sale-bill tab cannot key (`VRNO`, `ITEM_CODE`) keep their stored
 * rate; a row with no rate at all keeps its stored `value`, and the gross total
 * is derived from that value. Nothing is ever cleared.
 *
 * Env: `GMD_EXECUTION_TRACKING_SPREADSHEET_ID` (or the hard-coded workbook) and
 * `SALE_BILL_GID`.
 */

import "dotenv/config";
import { runSupplyRateBackfill } from "@/lib/supplyRateBackfill";

const USAGE = `
Supply History RATE / VALUE / GROSS TOTAL overwrite
(SALE BILL RATE -> rate, value = quantity x rate, gross total = value x 1.18)

Usage:
  tsx scripts/backfill-supply-rate-value.ts [--apply] [--limit <n>]

Options:
  --apply      Write the values. Without it the run is a dry run.
  --limit <n>  Consider only the first n rows (smoke test).
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

  const result = await runSupplyRateBackfill({
    overwrite: true,
    apply: args.apply,
    limit: args.limit,
  });

  if (!args.apply) {
    console.log("[backfill] dry run complete — no DB writes. Re-run with --apply to write.");
  } else if (result.failedWrites > 0) {
    console.log(`[backfill] finished with ${result.failedWrites} failed write(s) — see the log above.`);
    process.exitCode = 1;
  }
}

main()
