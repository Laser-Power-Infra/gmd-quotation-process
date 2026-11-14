// Loads GMD_Actuator_Master.xlsx into the actuator tables (db-quotation).
//
// Run: pnpm actuator:import <path-to.xlsx>
//
// Re-runnable: upserts by key (ACT CODE, GB CODE, MAP KEY, ERP code, ...) and deletes rows no
// longer in the file. offerDate / offerValidTill on ActuatorMaster are not in the workbook and
// are left as they are. SUITABILITY (4k+ rows) is replaced as a whole inside one transaction.
// Ends by re-pricing every linked actuated docket item with the new prices.
import "dotenv/config"; // first: lib/prisma (used by the re-price below) reads the env when it loads
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readActuatorWorkbook, updateData } from "../lib/actuatorMaster";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pnpm actuator:import <path-to-GMD_Actuator_Master.xlsx>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Row = Record<string, string | number | null>;

/** Upsert every row by `key`, then delete rows whose key is not in the file. */
async function sync(name: string, delegate: any, key: string, rows: Row[]) {
  if (rows.length === 0) throw new Error(`${name}: no rows parsed, refusing to delete everything.`);
  for (const data of rows) {
    await delegate.upsert({ where: { [key]: data[key] }, update: updateData(data), create: data });
  }
  const removed = await delegate.deleteMany({ where: { [key]: { notIn: rows.map((r) => r[key]) } } });
  console.log(`${name}: ${rows.length} upserted, ${removed.count} removed.`);
}

async function main() {
  const p = readActuatorWorkbook(path);
  await sync("ActuatorMaster", prisma.actuatorMaster, "actCode", p.actuators);
  await sync("GearboxMaster", prisma.gearboxMaster, "gbCode", p.gearboxes);
  await sync("ValveTorque", prisma.valveTorque, "key", p.valveTorques);
  await sync("ActuatorParam", prisma.actuatorParam, "name", p.params);
  await sync("ActuatorMapping", prisma.actuatorMapping, "mapKey", p.mappings);
  await sync("GmdGearboxStock", prisma.gmdGearboxStock, "erpCode", p.gearboxStock);
  await sync("ActuatorStock", prisma.actuatorStock, "erpCode", p.actuatorStock);
  if (p.suitability.length === 0) throw new Error("ActuatorSuitability: no rows parsed.");
  await prisma.$transaction([
    prisma.actuatorSuitability.deleteMany(),
    prisma.actuatorSuitability.createMany({ data: p.suitability }),
  ]);
  console.log(`ActuatorSuitability: ${p.suitability.length} rows written.`);

  // New prices / mapping reach the dockets straight away: no Fetch Actuator press needed.
  const { repriceLinkedActuatorItems } = await import("../lib/actuatorItem");
  const r = await repriceLinkedActuatorItems();
  console.log(`Docket items re-priced: ${r.priced} priced, ${r.pending} still pending, ${r.skipped} skipped (frozen), ${r.failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
