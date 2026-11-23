// Loads GMD_Actuator_Master.xlsx into the actuator tables (db-quotation), the tables the Mapping page shows.
// The page also refreshes them itself from the live sheet when it is opened (lib/actuatorTablesSync); this is the by-hand way.
//
// Run: pnpm actuator:import <path-to.xlsx> [--reprice]
//
// Re-runnable: upserts by key (ACT CODE, GB CODE, MAP KEY, ERP code, ...) and deletes rows no
// longer in the file. offerDate / offerValidTill on ActuatorMaster are not in the workbook and
// are left as they are. SUITABILITY (4k+ rows) is replaced as a whole inside one transaction.
// Dockets are NOT re-priced unless --reprice is given: old dockets are re-priced only when touched (Fetch Actuator or an
// item edit). With --reprice it ends by re-pricing every linked actuated docket item from the live sheet.
import "dotenv/config"; // first: lib/prisma reads the env when it loads
import { readActuatorWorkbook } from "../lib/actuatorMaster";
import { syncActuatorTables } from "../lib/actuatorTablesSync";

const args = process.argv.slice(2);
const reprice = args.includes("--reprice");
const path = args.find((a) => !a.startsWith("--"));
if (!path) {
  console.error("Usage: pnpm actuator:import <path-to-GMD_Actuator_Master.xlsx> [--reprice]");
  process.exit(1);
}

async function main() {
  await syncActuatorTables(readActuatorWorkbook(path!), console.log);

  if (!reprice) {
    console.log("Docket items were not re-priced. To re-price every linked actuated docket item, run again with --reprice.");
    return;
  }
  const { repriceLinkedActuatorItems } = await import("../lib/actuatorItem");
  const r = await repriceLinkedActuatorItems();
  console.log(`Docket items re-priced: ${r.priced} priced, ${r.pending} still pending, ${r.skipped} skipped (frozen), ${r.failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => (await import("../lib/prisma")).prisma.$disconnect());
