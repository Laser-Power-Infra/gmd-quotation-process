// One-off: links old actuated docket lines that never got actuator / gearbox codes (before the auto-fill existed).
// Run: pnpm actuator:backfill           (dry run: lists what each line would get, writes nothing)
//      pnpm actuator:backfill --apply   (links the lines that price in full; pending / OEM / frozen lines are left alone)
import "dotenv/config"; // first: lib/prisma reads the env when it loads

const apply = process.argv.includes("--apply");

async function main() {
  const { backfillUnlinkedActuatorItems } = await import("../lib/actuatorItem");
  const rows = await backfillUnlinkedActuatorItems(apply);
  console.table(rows.map((r) => ({ docket: r.docket, item: r.itemName.slice(0, 40), oldCost: String(r.oldCost ?? ""), actCode: r.actCode, gbCode: r.gbCode, newTotal: r.total, status: r.status })));
  const by = (p: string) => rows.filter((r) => r.status.startsWith(p)).length;
  console.log(`${rows.length} unlinked actuated lines: ${by(apply ? "linked" : "would link")} ${apply ? "linked" : "would link"}, ${by("left alone")} left alone (pending), ${by("skipped")} skipped, ${by("failed")} failed.`);
  if (!apply) console.log("Dry run: nothing was written. Run again with --apply to link.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => (await import("../lib/prisma")).prisma.$disconnect());
