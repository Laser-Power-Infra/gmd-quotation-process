/**
 * "GMD DISPATCH SL NO" sheet (master tab + 7 valve-type tabs) -> `valve_serial`.
 *
 *   npm run serials:import         # dry run (default): prints the report, writes nothing
 *   npm run serials:import:apply   # creates new serials, fills blank fields on existing ones
 *
 * Re-runnable until the sheet is frozen: an existing row's filled field is never
 * overwritten (a different sheet value is printed as a conflict). After that the
 * app is where serials are entered. --apply needs migration 20261114100000.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import { DISPATCH_SPREADSHEET_ID, DISPATCH_TABS, mergeBySerial, parseDispatchTab, planImport, type Conflict } from "@/lib/dispatchSerials";

const apply = process.argv.includes("--apply");
const SOURCE = "GMD DISPATCH SL NO sheet";

const printConflicts = (title: string, list: Conflict[]) => {
  console.log(`\n${title}: ${list.length}`);
  for (const c of list) console.log(`  ${c.serialNo} ${c.field}: kept "${c.kept}", ignored "${c.ignored}" (${c.where})`);
};

async function main() {
  const tabs = [];
  for (const tab of DISPATCH_TABS) {
    const read = await readSheetTabByGid(DISPATCH_SPREADSHEET_ID, tab.gid);
    const { records, noSerial } = parseDispatchTab(tab, read);
    console.log(`${read.tabTitle} (gid ${tab.gid}): ${records.length} serial rows, ${noSerial.length} rows without a valve serial`);
    tabs.push({ source: read.tabTitle, records, noSerial });
  }

  console.log(`\nRows without a valve serial in "${tabs[0].source}" (not imported):`);
  for (const row of tabs[0].noSerial) console.log(`  ${row.map((c) => String(c ?? "").trim()).join(" | ")}`);

  const { bySerial, conflicts } = mergeBySerial(tabs);
  printConflicts("Conflicts inside the sheet (first row kept)", conflicts);

  // SELECT * so the dry run also works before the migration adds the new columns.
  const existing = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "valve_serial"`;
  const plan = planImport(bySerial, existing);
  printConflicts("Conflicts with the app (app value kept)", plan.conflicts);
  console.log(`\n${bySerial.size} distinct serials: ${plan.creates.length} new, ${plan.updates.length} existing rows get blank fields filled, ${existing.length} rows in the app now.`);

  if (!apply) {
    console.log("\ndry run: nothing written. Re-run with --apply to write.");
    return;
  }
  let created = 0;
  for (let i = 0; i < plan.creates.length; i += 1000) {
    const chunk = plan.creates.slice(i, i + 1000).map((r) => ({ ...r, assignedBy: SOURCE }));
    created += (await prisma.valveSerial.createMany({ data: chunk, skipDuplicates: true })).count;
  }
  for (const u of plan.updates) await prisma.valveSerial.update({ where: { serialNo: u.serialNo }, data: u.data });
  console.log(`\napplied: ${created} serials created, ${plan.updates.length} rows filled.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
