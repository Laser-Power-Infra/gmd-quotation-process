import type { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import { deriveMapKey, isActuated } from "@/lib/actuatorCost";
import { actuatorBomLines, resolveStockCodes, type BomLine, type StockCodes } from "@/lib/actuatorStock";
import { livePhysicalQty } from "@/lib/actuatorStockSync";

export type DocketActuated = Awaited<ReturnType<typeof loadActuatedDocketItems>>[number];

/** Docket items that are linked actuated (ACT / ACT+GB / ELECTRIC / ACTUATOR with an actuator link) and have an item code. */
export async function loadActuatedDocketItems() {
  const all = await prisma.enquiryItem.findMany({ where: { erpItemCode: { not: null } }, select: { erpItemCode: true, operationType: true, itemType: true, actCode: true, gbCode: true, actuatorBreakdown: true } });
  return all.filter(isActuated);
}

/** ERP codes (actuator with most free qty, gearbox) to put on the BOM of each item code that is on a docket as linked ACT / ACT+GB. */
export async function actuatorStockCodesFor(
  docketItems: DocketActuated[],
  fullItems: { itemCode: string | null; itemType: string | null; size: string | null; pnGmd: string | null }[],
): Promise<{ byCode: Map<string, StockCodes>; live: Map<string, number> }> {
  const [mappings, actStock] = await Promise.all([
    prisma.actuatorMapping.findMany({ select: { mapKey: true, gmdGbCode: true } }),
    prisma.actuatorStock.findMany({ select: { erpCode: true, actCode: true } }),
  ]);
  const gmdGb = new Map(mappings.map((m) => [m.mapKey, m.gmdGbCode]));
  const byCode = new Map<string, StockCodes>();
  for (const fi of fullItems) {
    const docket = docketItems.find((d) => d.erpItemCode?.trim() === fi.itemCode?.trim());
    if (!docket || !fi.itemCode) continue;
    const key = deriveMapKey({ itemType: fi.itemType, size: fi.size, pnRating: fi.pnGmd });
    byCode.set(fi.itemCode.trim(), resolveStockCodes(docket, key ? gmdGb.get(key) : null, actStock));
  }
  const live = await livePhysicalQty([...new Set([...byCode.values()].flatMap((c) => [...c.act, c.gb ?? ""]))].filter(Boolean)).catch(() => new Map<string, number>());
  return { byCode, live };
}

/**
 * Proposes EDIT drafts (the BOM change workflow: Draft -> Submitted -> Approved) that add the actuator and gearbox ERP codes
 * to the open BOM of every item code quoted as ACT / ACT+GB. Nothing is applied here. These lines are for material
 * requirement only: cost comes from the actuator build-up, never from them (see actuatorErpCodes in verifyBomLookup.ts).
 * Never throws; a failure is logged and counted.
 */
export async function proposeActuatorBomChanges(source: string): Promise<{ proposed: number; failed: number }> {
  try {
    const docketItems = await loadActuatedDocketItems();
    const codes = [...new Set(docketItems.map((i) => i.erpItemCode!.trim()))];
    if (!codes.length) return { proposed: 0, failed: 0 };
    const [fullItems, pending] = await Promise.all([
      prisma.fullItem.findMany({ where: { itemCode: { in: codes } }, include: { boms: { include: { components: { include: { rawMaterial: { select: { erpItemCode: true } }, fullItem: { select: { itemCode: true } } } } } } } }),
      prisma.bomChange.findMany({ where: { status: { in: ["DRAFT", "SUBMITTED"] } }, select: { itemCode: true } }),
    ]);
    const busy = new Set(pending.map((p) => p.itemCode.trim().toUpperCase()));
    const { byCode, live } = await actuatorStockCodesFor(docketItems, fullItems);
    const wanted = fullItems.flatMap((fi) => {
      const bom = fi.boms.find((b) => b.components.some((c) => !c.noUse));
      const stockCodes = byCode.get((fi.itemCode ?? "").trim());
      if (!bom || !stockCodes || busy.has((fi.itemCode ?? "").toUpperCase())) return [];
      return [{ fi, bom, stockCodes }];
    });

    let proposed = 0;
    for (const { fi, bom, stockCodes } of wanted) {
      const open: BomLine[] = bom.components.filter((c) => !c.noUse)
        .map((c) => ({ code: (c.rawMaterial?.erpItemCode ?? c.fullItem?.itemCode ?? "").trim(), qty: c.quantity ?? 1 })).filter((l) => l.code);
      const add = actuatorBomLines(stockCodes, live, open);
      if (!add.length) continue;
      await prisma.bomChange.create({
        data: { kind: "EDIT", status: "DRAFT", itemCode: fi.itemCode!.trim(), bomId: bom.bomId, lines: [...open, ...add] as unknown as Prisma.InputJsonArray, source, note: `Add actuator / gearbox: ${add.map((l) => l.code).join(", ")}`, createdBy: "system" },
      });
      proposed++;
    }
    if (proposed) console.log(`[actuator-bom] ${source}: proposed ${proposed} BOM edit(s)`);
    return { proposed, failed: 0 };
  } catch (error) {
    console.error(`[actuator-bom] ${source}: ${error instanceof Error ? error.message : error}`);
    return { proposed: 0, failed: 1 };
  }
}
