import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VERIFY_BOM_HEADERS,
  dbVerifyBomToRow,
} from "@/lib/gmd_lib/verify-bom-columns";
import { getBomUseStatusBatch } from "@/lib/verifyBomLookup";

export async function GET() {
  try {
    const items = await prisma.verifyBom.findMany({
      orderBy: { syncedAt: "desc" },
    });

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const bomIds = [
      ...new Set(items.map((i) => i.bomId).filter((b): b is string => !!b)),
    ];
    const statusMap = await getBomUseStatusBatch(bomIds);

    const codes = [
      ...new Set(items.map((i) => i.rmItemCode).filter((c): c is string => !!c)),
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

    const storedNoUse = new Map(items.map((i) => [i.id, i.noUse]));
    const storedStock = new Map(
      items.map((i) => [i.id, i.availableStock ?? null]),
    );
    const updates = items
      .map((item) => {
        const noUse = item.bomId ? (statusMap.get(item.bomId) ?? "") : null;
        const stock = item.rmItemCode
          ? (stockMap.get(item.rmItemCode) ?? "")
          : null;
        return { id: item.id, noUse, stock };
      })
      .filter(
        ({ id, noUse, stock }) =>
          storedNoUse.get(id) !== noUse || storedStock.get(id) !== stock,
      )
      .map(({ id, noUse, stock }) =>
        prisma.verifyBom.update({
          where: { id },
          data: { noUse, availableStock: stock },
        }),
      );
    if (updates.length > 0) {
      await prisma.$transaction(updates, {
        timeout: 10000, // 10 seconds
      });
    }

    const rows = items.map((item) =>
      dbVerifyBomToRow({
        ...item,
        noUse: item.bomId ? (statusMap.get(item.bomId) ?? "") : "",
        availableStock: item.rmItemCode
          ? (stockMap.get(item.rmItemCode) ?? "")
          : "",
      }),
    );

    return NextResponse.json({
      headers: VERIFY_BOM_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
