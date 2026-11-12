/**
 * One-off: fill blank Payment Terms / Inspection / PBG on existing enquiries.
 * Same rule as the New Enquiry form: the party's latest enquiry that has the
 * field, else the default (30 days / Our Scope @ 1% / NA). Only the three text
 * fields are written; item costs and rates are left as they are.
 *
 *   npx tsx scripts/backfill-blank-terms.ts          # dry run, prints what would change
 *   npx tsx scripts/backfill-blank-terms.ts --apply  # write
 */
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";
import { DEFAULT_TERMS, isBlankTerm } from "../lib/commercialTerms";

const pool = new Pool({ connectionString: process.env.QUOTATION_DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const APPLY = process.argv.includes("--apply");
const KEYS = ["paymentTerms", "inspection", "pbg"] as const;

async function main() {
  // Newest first, so the first filled value per party is the latest one.
  const all = await prisma.enquiry.findMany({
    select: { id: true, docketNumber: true, partyName: true, paymentTerms: true, inspection: true, pbg: true },
    orderBy: [{ enquiryDate: "desc" }, { createdAt: "desc" }],
  });

  let changed = 0;
  for (const e of all) {
    const data: Partial<Record<(typeof KEYS)[number], string>> = {};
    for (const k of KEYS) {
      if (!isBlankTerm(e[k])) continue;
      const last = all.find((p) => p.partyName === e.partyName && !isBlankTerm(p[k]));
      data[k] = last?.[k] ?? DEFAULT_TERMS[k];
    }
    if (Object.keys(data).length === 0) continue;
    changed++;
    console.log(`${e.docketNumber} (${e.partyName}): ${JSON.stringify(data)}`);
    if (APPLY) await prisma.enquiry.update({ where: { id: e.id }, data });
  }
  console.log(`\n${changed} of ${all.length} enquiries ${APPLY ? "updated" : "would change (dry run, pass --apply to write)"}.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
