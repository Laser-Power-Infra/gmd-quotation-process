/**
 * DEBTORS sheet -> `Debtor` table. Manual CLI.
 *
 *   npm run debtors:sync                     # dry run (default): prints the report, writes nothing
 *   npm run debtors:sync:apply               # replaces the table with the sheet's rows
 *   npm run debtors:sync -- --dump-headers   # read-only: the real headers and column map
 *
 * The table has no unique key (opening-balance lines repeat the same
 * accCode + tCode + vrNo), so the sheet is copied as a snapshot: apply deletes
 * every `Debtor` row and inserts the sheet's rows in one transaction. Rows that
 * cannot be mapped (blank ACC_CODE, bad number or date) are skipped and listed.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import {
  DEBTORS_GID,
  DEBTORS_HEADERS,
  mapDebtorRow,
  resolveDebtorColumns,
  type DebtorRecord,
} from "@/lib/debtorsSync";

const CHUNK = 500;

const apply = process.argv.includes("--apply");
const dumpHeaders = process.argv.includes("--dump-headers");

async function main() {
  const spreadsheetId = process.env.GMD_EXECUTION_TRACKING_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("GMD_EXECUTION_TRACKING_SPREADSHEET_ID is not set");

  const { tabTitle, headers, rows } = await readSheetTabByGid(spreadsheetId, DEBTORS_GID);
  console.log(`tab "${tabTitle}" (gid ${DEBTORS_GID}): ${rows.length} data rows`);

  if (dumpHeaders) {
    console.log(`headers: ${JSON.stringify(headers)}`);
    console.log(`expected: ${JSON.stringify(Object.values(DEBTORS_HEADERS))}`);
    return;
  }

  const idx = resolveDebtorColumns(headers, tabTitle);

  const records: DebtorRecord[] = [];
  const skipped: { line: number; error: string }[] = [];
  rows.forEach((row, i) => {
    const result = mapDebtorRow(row, idx);
    if (result.ok) records.push(result.record);
    else skipped.push({ line: i + 2, error: result.error }); // +2: header row, 1-based
  });

  const inDb = await prisma.debtor.count();

  console.log(`mappable : ${records.length}`);
  console.log(`skipped  : ${skipped.length}`);
  for (const s of skipped.slice(0, 15)) console.log(`  line ${s.line}: ${s.error}`);
  if (skipped.length > 15) console.log(`  ...and ${skipped.length - 15} more`);
  console.log(`in DB now: ${inDb} (will be replaced by ${records.length})`);

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to replace the table.");
    return;
  }

  const inserts = [];
  for (let i = 0; i < records.length; i += CHUNK) {
    inserts.push(prisma.debtor.createMany({ data: records.slice(i, i + CHUNK) }));
  }
  await prisma.$transaction([prisma.debtor.deleteMany(), ...inserts]);
  console.log(`\napplied: ${records.length} rows written, ${inDb} replaced.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
