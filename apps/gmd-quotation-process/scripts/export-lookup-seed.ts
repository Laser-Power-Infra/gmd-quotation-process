// Dumps LookupOption to a seed file for the mirror app.
// Usage: npx tsx scripts/export-lookup-seed.ts [outPath]
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "../../packages/db-quotation/prisma/seeds/lookup-option.seed.ts");
const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const rows = await prisma.lookupOption.findMany({ orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { value: "asc" }] });
  const types = new Set(rows.map((r) => r.type)).size;
  const body = rows
    .map((r) => "  " + JSON.stringify({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))
    .join(",\n");
  const src = `// LookupOption seed: ${rows.length} rows across ${types} types, exported ${new Date().toISOString().slice(0, 10)}.
// Run: npx tsx --env-file=.env prisma/seeds/lookup-option.seed.ts
import { applyLookupSync, type LookupRow } from "../../lib/lookupSync";
import { prisma } from "../../lib/prisma";

const ROWS: LookupRow[] = [
${body},
];

async function main() {
  await applyLookupSync({ upsert: ROWS, delete: [] });
  const counts = await prisma.lookupOption.groupBy({ by: ["type"], _count: { _all: true }, orderBy: { type: "asc" } });
  for (const c of counts) console.log(c.type.padEnd(30), c._count._all);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, src);
  console.log(`Wrote ${rows.length} rows to ${out}`);
}

main().finally(() => pool.end());
