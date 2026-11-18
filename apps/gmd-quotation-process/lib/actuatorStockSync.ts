import { Prisma } from "@gmd/db-quotation";
import { stockPrisma } from "@gmd/db-stock";
import { prisma } from "@/lib/prisma";
import { deriveMapKey, isActuated } from "@/lib/actuatorCost";
import { loadActuatorMaster } from "@/lib/actuatorSheet";
import { resolveStockCodes, stockSummary } from "@/lib/actuatorStock";

/** Live Physical Stock available qty per ERP code (several lines per code are summed). Same field stock allocation uses. */
export async function livePhysicalQty(codes: string[]): Promise<Map<string, number>> {
  const live = new Map<string, number>();
  if (!codes.length) return live;
  const rows = await stockPrisma.physicalStock.findMany({ where: { erp_code: { in: codes } }, select: { erp_code: true, available_qty: true } });
  for (const r of rows) {
    const n = parseFloat((r.available_qty ?? "").replace(/,/g, ""));
    live.set(r.erp_code!, (live.get(r.erp_code!) ?? 0) + (Number.isNaN(n) ? 0 : n));
  }
  return live;
}

/** Free qty per ERP code: live Physical Stock available minus what the stock allocation ledger has booked against the code. */
export async function freeQty(codes: string[]): Promise<Map<string, number>> {
  const [free, booked] = await Promise.all([
    livePhysicalQty(codes),
    codes.length ? stockPrisma.stockAllocation.groupBy({ by: ["erpCode"], where: { erpCode: { in: codes } }, _sum: { qty: true } }) : [],
  ]);
  for (const b of booked) free.set(b.erpCode, (free.get(b.erpCode) ?? 0) - (b._sum.qty ?? 0));
  return free;
}

/**
 * Part of "Sync Available Stock": for actuated items with an actuator / gearbox code, reads the free qty of their ERP codes
 * (the pick's stock lines) and stores it in actuatorBreakdown.stock (shown on the Actuator chip, flagged red when free < docket qty).
 */
export async function syncActuatorStock(itemIds?: string[]): Promise<{ updatedIds: string[]; short: number }> {
  const items = await prisma.enquiryItem.findMany({
    where: { ...(itemIds?.length ? { id: { in: itemIds } } : {}), OR: [{ actCode: { not: null } }, { gbCode: { not: null } }] },
  });
  const actuated = items.filter(isActuated);
  if (!actuated.length) return { updatedIds: [], short: 0 };
  const master = await loadActuatorMaster();
  const gmdGb = new Map(master.mappings.map((m) => [m.mapKey, m.gmdGbCode as string | null]));
  const actStock = master.actuatorStock as { erpCode: string; actCode: string | null }[];
  const plan = actuated.map((it) => ({ it, codes: resolveStockCodes(it, gmdGb.get(deriveMapKey(it) ?? ""), actStock) }));
  const live = await freeQty([...new Set(plan.flatMap((p) => [...p.codes.act, p.codes.gb ?? ""]))].filter(Boolean));

  const updatedIds: string[] = [];
  let short = 0;
  for (const { it, codes } of plan) {
    const s = stockSummary(it, codes, live, it.quantity == null ? null : Number(it.quantity));
    if (s.short.length) short++;
    const b = (it.actuatorBreakdown ?? {}) as Record<string, unknown>;
    if (JSON.stringify(b.stock) === JSON.stringify(s)) continue;
    await prisma.enquiryItem.update({ where: { id: it.id }, data: { actuatorBreakdown: { ...b, stock: s } as unknown as Prisma.InputJsonObject } });
    updatedIds.push(it.id);
  }
  return { updatedIds, short };
}

