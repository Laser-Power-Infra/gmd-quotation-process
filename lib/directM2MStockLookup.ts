import { prisma } from "@/lib/prisma";

/**
 * Returns a map of rmItemCode -> availableStock for all given RM codes,
 * strictly filtering out null, undefined, or empty-string values (keeps "0" and positive numbers).
 */
export async function getRmStockMap(rmCodes: string[]): Promise<Map<string, string>> {
  const stockMap = new Map<string, string>();
  if (!rmCodes.length) return stockMap;

  const uniqueRmCodes = [...new Set(rmCodes.filter(Boolean))];

  const records = await prisma.gMDUpdateItem.findMany({
    where: { erpItemCode: { in: uniqueRmCodes } },
    select: { erpItemCode: true, availableStock: true },
  });

  for (const record of records) {
    if (!record.erpItemCode) continue;
    const stockVal = record.availableStock;
    // Keep only non-null, non-undefined, non-empty values (Option B: "0" is kept)
    if (stockVal !== null && stockVal !== undefined && stockVal.trim() !== "") {
      stockMap.set(record.erpItemCode, stockVal.trim());
    }
  }

  return stockMap;
}

/**
 * Syncs availableStock into EnquiryItem from GMDUpdateItem for items with bomType = 'DIRECT M2M'.
 * Can optionally target specific itemIds or all matching items.
 */
export async function syncDirectM2MAvailableStock(itemIds?: string[]): Promise<{ updatedCount: number }> {
  const whereClause: any = {
    bomType: "DIRECT M2M",
    rmItemCode: { not: null },
  };

  if (itemIds && itemIds.length > 0) {
    whereClause.id = { in: itemIds };
  }

  const items = await prisma.enquiryItem.findMany({
    where: whereClause,
    select: { id: true, rmItemCode: true, availableStock: true },
  });

  if (!items.length) {
    return { updatedCount: 0 };
  }

  const rmCodes = items.map((i) => i.rmItemCode).filter(Boolean) as string[];
  const stockMap = await getRmStockMap(rmCodes);

  let updatedCount = 0;
  for (const item of items) {
    if (!item.rmItemCode) continue;
    const stock = stockMap.get(item.rmItemCode);
    if (stock !== undefined && stock !== item.availableStock) {
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { availableStock: stock },
      });
      updatedCount++;
    }
  }

  return { updatedCount };
}
