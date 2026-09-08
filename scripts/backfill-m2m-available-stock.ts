import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { getRmStockMap } from "../lib/directM2MStockLookup";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("\n=== BACKFILLING DIRECT M2M AVAILABLE STOCK (OPTION B: NON-EMPTY) ===\n");

  const items = await prisma.enquiryItem.findMany({
    where: {
      bomType: "DIRECT M2M",
      rmItemCode: { not: null },
    },
    select: {
      id: true,
      rmItemCode: true,
      availableStock: true,
      erpItemCode: true,
    },
  });

  console.log(`Found ${items.length} EnquiryItems with bomType = 'DIRECT M2M' and rmItemCode != null.`);

  const rmCodes = items.map((i) => i.rmItemCode).filter(Boolean) as string[];
  const stockMap = await getRmStockMap(rmCodes);

  console.log(`Matched ${stockMap.size} distinct RM codes with valid, non-empty available stock in GMDUpdateItem.`);

  let updatedCount = 0;
  let alreadyUpToDate = 0;
  let noStockFound = 0;

  for (const item of items) {
    if (!item.rmItemCode) continue;
    const stock = stockMap.get(item.rmItemCode);
    if (stock === undefined) {
      noStockFound++;
      continue;
    }

    if (item.availableStock === stock) {
      alreadyUpToDate++;
      continue;
    }

    await prisma.enquiryItem.update({
      where: { id: item.id },
      data: { availableStock: stock },
    });
    updatedCount++;
  }

  console.log("\n=== BACKFILL SUMMARY ===");
  console.log(`Items updated with available stock: ${updatedCount}`);
  console.log(`Items already matching:             ${alreadyUpToDate}`);
  console.log(`Items with no stock / skipped:       ${noStockFound}`);
  console.log(`Total items evaluated:              ${items.length}`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
