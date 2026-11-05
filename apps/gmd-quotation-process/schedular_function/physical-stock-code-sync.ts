/**
 * Snapshot quotation DB -> stock DB for the Physical Stock New Item ERP-code picker:
 * `RmCodeOption` (all RawMaterial codes) and `BomCodeOption` (CREATE BOM -> RM codes).
 * Each table is replaced in ONE transaction (delete + chunked insert), so a failed insert
 * leaves the previous snapshot. Run as a step of `physical-stock-cost-bom`.
 */
import { prisma } from "@/lib/prisma";
import { stockPrisma } from "@/lib/stockPrisma";
import { flattenCreateBoms } from "@/lib/physicalStockCodeOptions";
import { refreshDerived } from "@gmd/physical-stock/server";

const CHUNK = 2000;
const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

export type CodeOptionsSyncResult = { rmCodes: number; bomCodes: number; fgBomCodes: number };

export async function syncPhysicalStockCodeOptions(): Promise<CodeOptionsSyncResult> {
  const rms = await prisma.rawMaterial.findMany({
    where: { erpItemCode: { not: null } },
    select: { erpItemCode: true, itemNameAuto: true, itemNameDerived: true, l8ItemCategory: true },
  });
  // erpItemCode is unique in the quotation DB; the Set guards the stock table's unique index anyway.
  const seen = new Set<string>();
  const rmRows = [];
  for (const r of rms) {
    const erpItemCode = (r.erpItemCode ?? "").trim();
    if (!erpItemCode || seen.has(erpItemCode)) continue;
    seen.add(erpItemCode);
    rmRows.push({
      erpItemCode,
      itemName: r.itemNameAuto?.trim() || r.itemNameDerived?.trim() || null,
      l8Category: r.l8ItemCategory?.trim() || null,
    });
  }

  const boms = await prisma.bom.findMany({
    where: { bomIdType: { contains: "create", mode: "insensitive" } },
    select: {
      bomId: true,
      bomIdType: true,
      fullItem: { select: { itemType: true, size: true, pnGmd: true } },
      components: { select: { rawMaterial: { select: { erpItemCode: true } } } },
    },
  });
  const bomRows = flattenCreateBoms(boms);

  // Finished-valve FGs that own a BOM: the stock dashboard matches on type + MOC + size only.
  const fgs = await prisma.fullItem.findMany({
    where: { itemCode: { not: null }, boms: { some: {} } },
    select: { itemCode: true, itemType: true, moc: true, size: true, boms: { select: { bomId: true } } },
    orderBy: { itemCode: "asc" },
  });
  const fgRows = fgs.flatMap((f) =>
    f.boms.map((b) => ({
      fgCode: (f.itemCode ?? "").trim(),
      bomId: b.bomId,
      itemType: f.itemType?.trim() || null,
      moc: f.moc?.trim() || null,
      size: f.size?.trim() || null,
    })),
  );

  await stockPrisma.$transaction(
    [
      stockPrisma.rmCodeOption.deleteMany(),
      ...chunks(rmRows).map((data) => stockPrisma.rmCodeOption.createMany({ data })),
    ],
  );
  await stockPrisma.$transaction([
    stockPrisma.bomCodeOption.deleteMany(),
    ...chunks(bomRows).map((data) => stockPrisma.bomCodeOption.createMany({ data })),
  ]);
  await stockPrisma.$transaction([
    stockPrisma.fgBomOption.deleteMany(),
    ...chunks(fgRows).map((data) => stockPrisma.fgBomOption.createMany({ data })),
  ]);
  // FG ITEM CODE / PRODUCTION ITEM are stored on PhysicalStock so the page can filter them in SQL.
  await refreshDerived();
  return { rmCodes: rmRows.length, bomCodes: bomRows.length, fgBomCodes: fgRows.length };
}
