import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBomUseStatusBatch } from "@/lib/verifyBomLookup";

export async function POST() {
  try {
    const items = await prisma.verifyBom.findMany({
      select: {
        id: true,
        bomId: true,
        itemCode: true,
        noUse: true,
        availableStock: true,
      },
    });

    const bomIds = [
      ...new Set(items.map((i) => i.bomId).filter((b): b is string => !!b)),
    ];
    const statusMap = await getBomUseStatusBatch(bomIds);

    const codes = [
      ...new Set(items.map((i) => i.itemCode).filter((c): c is string => !!c)),
    ];
    const rawItems = await prisma.gMDUpdateItem.findMany({
      where: { erpItemCode: { in: codes } },
      select: { erpItemCode: true, availableStock: true },
    });
    const stockMap = new Map<string, string>();
    for (const r of rawItems) {
      if (!r.erpItemCode) continue;
      if (!stockMap.has(r.erpItemCode)) {
        stockMap.set(r.erpItemCode, r.availableStock ?? "");
      }
    }

    const updates = items
      .map((item) => {
        const noUse = item.bomId ? (statusMap.get(item.bomId) ?? "") : null;
        const stock = item.itemCode
          ? (stockMap.get(item.itemCode) ?? "")
          : null;
        return {
          id: item.id,
          noUse,
          stock,
          oldNoUse: item.noUse,
          oldStock: item.availableStock ?? null,
        };
      })
      .filter(
        ({ noUse, stock, oldNoUse, oldStock }) =>
          oldNoUse !== noUse || oldStock !== stock,
      )
      .map(({ id, noUse, stock }) =>
        prisma.verifyBom.update({
          where: { id },
          data: { noUse, availableStock: stock },
        }),
      );

    if (updates.length > 0) {
      await prisma.$transaction(updates, { timeout: 20000 });
    }

    return NextResponse.json({ success: true, verifyUpdated: updates.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}