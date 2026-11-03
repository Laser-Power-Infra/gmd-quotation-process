// Clears docket numbers the old follow-up sync regex invented from request
// wording ("Docket Creation" -> "Creation"), so the next sync re-flags those
// mails pending and they show on the Pending Dockets tab again.
// Dry run by default. Usage: npx tsx scripts/fix-junk-docket-numbers.ts [--apply]
import "dotenv/config";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL }) });

async function main() {
  const rows = await prisma.docketQuotationThread.findMany({
    where: { docketStatus: "RESOLVED", docketNo: { not: null } },
    select: { id: true, date: true, subject: true, docketNo: true },
    orderBy: { date: "desc" },
  });
  // A real docket number always carries digits.
  const junk = rows.filter((r) => r.docketNo && !/\d/.test(r.docketNo));
  console.table(junk.map((r) => ({ id: r.id, date: r.date?.toISOString().slice(0, 10), docketNo: r.docketNo, subject: (r.subject || "").slice(0, 70) })));
  console.log(`${junk.length} rows with a digit-less docket no.`);
  if (!process.argv.includes("--apply") || junk.length === 0) return;
  const res = await prisma.docketQuotationThread.updateMany({
    where: { id: { in: junk.map((r) => r.id) } },
    data: { docketNo: null, docketStatus: null, aiIsNewDocket: null },
  });
  console.log(`Cleared ${res.count} rows. Run the docket follow-up sync (full scan) to re-flag them pending.`);
}
main().finally(() => prisma.$disconnect());
