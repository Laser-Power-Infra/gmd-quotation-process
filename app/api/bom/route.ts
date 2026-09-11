import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VERIFY_BOM_HEADERS,
  dbVerifyBomToRow,
} from "@/lib/gmd_lib/verify-bom-columns";
import {
  recomputeVerifyBomValues,
} from "@/lib/verifyBomLookup";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { statusMap, stockMap, rmNameMap, itemNameMap } =
      await recomputeVerifyBomValues();

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

    const rows = items.map((item) =>
      dbVerifyBomToRow({
        ...item,
        noUse: item.bomId ? (statusMap.get(item.bomId) ?? "") : "",
        availableStock: item.rmItemCode
          ? (stockMap.get(item.rmItemCode) ?? "")
          : "",
        rmItemName: item.rmItemCode
          ? (rmNameMap.get(item.rmItemCode) ?? null)
          : null,
        itemName: item.itemCode
          ? (itemNameMap.get(item.itemCode) ?? item.itemName)
          : null,
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