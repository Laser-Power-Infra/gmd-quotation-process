import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { parseUtilityMaster } from "@gmd/contract-review/utility-master";

// Makes the UTILITY lookup exactly the utility master (data/utility-master.csv):
// value = Short Name, code + defaultState set. Any other UTILITY option is
// deactivated (never deleted). Dry-run by default; --apply writes.
// Already applied once: the UTILITY LookupOption rows are now the standard list
// for every dashboard, kept on /admin/lookup-options. Do not run --apply again.
const APPLY = process.argv.includes("--apply");
const TYPE = "UTILITY";
const CSV = path.join(__dirname, "..", "data", "utility-master.csv");

async function main() {
  console.log(`\n=== SEED UTILITY MASTER [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);
  console.warn(
    "WARNING: the master was seeded once already. Do not run --apply again: it reverts admin edits\n" +
      "to UTILITY options and deactivates every option added on /admin/lookup-options since.\n",
  );
  const master = parseUtilityMaster(readFileSync(CSV, "utf8"));
  const existing = await prisma.lookupOption.findMany({ where: { type: TYPE } });
  const byValue = new Map(existing.map((o) => [o.value, o]));
  const byCode = new Map(existing.filter((o) => o.code).map((o) => [o.code!, o]));

  let created = 0;
  let updated = 0;
  const keep = new Set<string>();
  for (const [i, m] of master.entries()) {
    const defaultState = m.state && !/verify/i.test(m.state) ? m.state : null;
    const row = byCode.get(m.code) ?? byValue.get(m.shortName);
    const data = { value: m.shortName, code: m.code, defaultState, sortOrder: i, isActive: true };
    if (row) {
      keep.add(row.id);
      const same = row.value === data.value && row.code === data.code && row.defaultState === data.defaultState
        && row.sortOrder === i && row.isActive;
      if (same) continue;
      updated++;
      console.log(`  update ${row.value} -> ${m.shortName} [${m.code}, ${defaultState ?? "-"}]`);
      if (APPLY) await prisma.lookupOption.update({ where: { id: row.id }, data });
    } else {
      created++;
      console.log(`  create ${m.shortName} [${m.code}, ${defaultState ?? "-"}]`);
      if (APPLY) await prisma.lookupOption.create({ data: { type: TYPE, ...data } });
    }
  }

  const deactivate = existing.filter((o) => !keep.has(o.id) && o.isActive);
  for (const o of deactivate) console.log(`  deactivate ${o.value}`);
  if (APPLY && deactivate.length) {
    await prisma.lookupOption.updateMany({
      where: { id: { in: deactivate.map((o) => o.id) } },
      data: { isActive: false },
    });
  }

  console.log(`\nMaster rows: ${master.length}. Create: ${created}, update: ${updated}, deactivate: ${deactivate.length}.`);
  if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
