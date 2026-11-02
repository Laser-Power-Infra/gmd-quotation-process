/**
 * SALE BILL / SALE REGISTER / BG sheet tabs -> `SaleBill` / `SaleRegister` / `BankGuarantee`. Manual CLI.
 *
 *   npm run debtors:joins:sync                     # dry run (default): prints the report, writes nothing
 *   npm run debtors:joins:sync:apply               # replaces the three tables with the sheet rows
 *   npm run debtors:joins:sync -- --dump-headers   # read-only: real headers vs expected
 *
 * Snapshot copy like `sync-debtors.ts`: apply deletes every row and re-inserts in one transaction.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import {
  BG_GID, BG_HEADERS, SALE_BILL_GID, SALE_BILL_HEADERS, SALE_REGISTER_GID, SALE_REGISTER_HEADERS,
  mapBg, mapSaleBill, mapSaleRegister, resolveCols,
} from "@/lib/debtorJoinsSync";

const CHUNK = 500;
const apply = process.argv.includes("--apply");
const dumpHeaders = process.argv.includes("--dump-headers");

async function load<T>(
  spreadsheetId: string,
  gid: number,
  expected: readonly string[],
  map: (row: string[], c: number[]) => T | null,
) {
  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, gid);
  console.log(`tab "${tabTitle}" (gid ${gid}): ${rows.length} data rows`);
  if (dumpHeaders) {
    console.log(`headers: ${JSON.stringify(headers)}\nexpected: ${JSON.stringify(expected)}`);
    return [];
  }
  const c = resolveCols(headers, expected, tabTitle);
  const out: T[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    try {
      const rec = map(row, c);
      if (rec) out.push(rec);
      else skipped++;
    } catch (err) {
      skipped++;
      console.log(`  line ${i + 2}: ${err instanceof Error ? err.message : err}`);
    }
  });
  console.log(`  mappable ${out.length}, skipped ${skipped}`);
  return out;
}

async function main() {
  const id = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!id) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");

  const bills = await load(id, SALE_BILL_GID, SALE_BILL_HEADERS, mapSaleBill);
  const regs = await load(id, SALE_REGISTER_GID, SALE_REGISTER_HEADERS, mapSaleRegister);
  const bgs = await load(id, BG_GID, BG_HEADERS, mapBg);
  if (dumpHeaders) return;

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to replace the tables.");
    return;
  }

  const chunks = <T>(a: T[]) => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));
  await prisma.$transaction([
    prisma.saleBill.deleteMany(),
    prisma.saleRegister.deleteMany(),
    prisma.bankGuarantee.deleteMany(),
    ...chunks(bills).map((data) => prisma.saleBill.createMany({ data })),
    ...chunks(regs).map((data) => prisma.saleRegister.createMany({ data })),
    ...chunks(bgs).map((data) => prisma.bankGuarantee.createMany({ data })),
  ]);
  console.log(`\napplied: ${bills.length} sale bills, ${regs.length} register rows, ${bgs.length} BGs.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
