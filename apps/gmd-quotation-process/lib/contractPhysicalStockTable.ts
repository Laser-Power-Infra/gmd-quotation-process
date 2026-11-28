import { stockPrisma } from "@gmd/db-stock";
import { sumTablePhysicalStock } from "@/lib/contractPhysicalStock";

/**
 * Per-code totals of the PhysicalStock table, one query for the whole batch.
 * Reads the two columns of every row rather than `erp_code in (...)`, so codes
 * differing only by case / spaces still match. Throws when the stock DB is unreachable.
 */
export async function fetchTablePhysicalStock(): Promise<Record<string, number>> {
  const rows = await stockPrisma.physicalStock.findMany({
    where: { erp_code: { not: null } },
    select: { erp_code: true, available_qty: true },
  });
  return sumTablePhysicalStock(rows);
}
