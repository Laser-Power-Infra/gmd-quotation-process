// Seeds the tender DB actuator pick-list (`actuator_options`) from the
// quotation app's `rawMaterial` table.
//
// Run: npx tsx scripts/seed-actuator-options.ts
//
// Re-runnable: upserts by normalized "L7@L6" value, then deletes options the
// quotation DB no longer has. Nothing here touches ContractReview rows.
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { prisma as tenderPrisma } from "@gmd/db-tender";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Same normalization the Actuator dropdown / save action use. */
const normalizeActuatorPart = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, " ");

async function main() {
  const rows = await prisma.rawMaterial.findMany({
    where: {
      l8ItemCategory: { contains: "ACTUATORS", mode: "insensitive" },
      transferred: false,
      OR: [
        { newItemStatus: null },
        { newItemStatus: "" },
        { newItemStatus: "-" },
        { newItemStatus: "Updated" },
      ],
    },
    select: { erpItemCode: true, l7Dimension: true, l6Std: true },
  });

  const codesByValue = new Map<string, Set<string>>();
  for (const r of rows) {
    const l7 = normalizeActuatorPart(r.l7Dimension ?? "");
    const l6 = normalizeActuatorPart(r.l6Std ?? "");
    if (!l7 || !l6) continue;
    const value = `${l7}@${l6}`;
    const codes = codesByValue.get(value) ?? new Set<string>();
    const code = (r.erpItemCode ?? "").trim();
    if (code) codes.add(code);
    codesByValue.set(value, codes);
  }

  const options = [...codesByValue.entries()]
    .map(([value, codes]) => ({
      value,
      rmCodeForActuator: [...codes].sort().join(",") || null,
    }))
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));

  if (options.length === 0) {
    console.warn(
      "No actuator options found in the quotation DB. Nothing written, nothing deleted.",
    );
    return;
  }

  for (const option of options) {
    await tenderPrisma.actuatorOption.upsert({
      where: { value: option.value },
      update: { rmCodeForActuator: option.rmCodeForActuator, syncedAt: new Date() },
      create: option,
    });
  }

  const removed = await tenderPrisma.actuatorOption.deleteMany({
    where: { value: { notIn: options.map((o) => o.value) } },
  });

  console.log(
    `Seeded ${options.length} actuator option(s) from ${rows.length} raw material row(s); removed ${removed.count} stale option(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await tenderPrisma.$disconnect();
    await pool.end();
  });
