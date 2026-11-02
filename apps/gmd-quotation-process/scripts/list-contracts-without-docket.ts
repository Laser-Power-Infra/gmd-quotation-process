// READ-ONLY. Usage: npx tsx scripts/list-contracts-without-docket.ts [--md]
import "dotenv/config";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { PrismaClient } from "@gmd/db-quotation";
import { PrismaPg } from "@prisma/adapter-pg";
import { liveContractsWithoutDocket } from "../lib/contractsWithoutDocket";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.QUOTATION_DATABASE_URL }) });

async function main() {
  const rows = await tenderPrisma.contractReview.findMany({
    select: { contractNo: true, status: true, partyNameDump: true, dateOfContract: true, itemCode: true, item: true, size: true, orderQty: true, offerNumber: true },
  });
  const enq = await prisma.enquiry.findMany({ where: { selectedContractNo: { isEmpty: false } }, select: { selectedContractNo: true } });
  const list = liveContractsWithoutDocket(rows, enq.flatMap((e) => e.selectedContractNo));
  const cell = (s: string | number) => String(s).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  if (process.argv.includes("--md")) {
    console.log("| # | Contract no | Party | Quotation ref (Offer No.) | Quotation date | Items | Qty | Contract date |\n|---|---|---|---|---|---|---|---|");
    list.forEach((c, i) => console.log(`| ${i + 1} | ${cell(c.contractNo)} | ${cell(c.party)} | ${cell(c.offers.join(", ") || "-")} | not in data | ${cell(c.items)} | ${c.qty} | ${cell(c.contractDate || "-")} |`));
  } else {
    console.table(list.map((c) => ({ contract: c.contractNo, party: c.party, quotationRef: c.offers.join(", "), items: c.items.slice(0, 80), qty: c.qty, contractDate: c.contractDate })));
  }
  console.error(`${list.length} live contracts with no docket (of ${new Set(rows.map((r) => r.contractNo)).size} contracts)`);
}
main().finally(() => Promise.all([prisma.$disconnect(), tenderPrisma.$disconnect()]));
