import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_REVIEW_HEADERS,
  dbContractReviewToRow,
} from "@/lib/gmd_lib/contract-review-columns";
import {
  getBatchDistinctBomIds,
  getBomRmAvailBatch,
  recomputeVerifyBomValues,
  computeContractReviewRmAvail,
} from "@/lib/verifyBomLookup";

export async function GET() {
  try {
    await recomputeVerifyBomValues();

    const [items, pnRatingRows] = await Promise.all([
      prisma.contractReview.findMany({
        orderBy: { syncedAt: "desc" },
      }),
      prisma.lookupOption.findMany({
        where: { type: { in: ["PN_RATING", "pnRating"] }, isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        select: { value: true },
      }),
    ]);

    const pnRatingOptions = [...new Set(pnRatingRows.map((r) => r.value.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );

    const withBom = items.filter((i) => i.bomId);
    const bomIds = [
      ...new Set(withBom.map((i) => i.bomId).filter((b): b is string => !!b)),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const noUseUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (noUseUpdates.length > 0) {
      await prisma.$transaction(noUseUpdates);
    }
    for (const item of items) {
      if (item.bomId) item.noUse = availMap.get(item.id) ?? null;
    }

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    const codes = [
      ...new Set(items.map((i) => i.itemCode).filter(Boolean)),
    ];
    const bomMap = await getBatchDistinctBomIds(codes);
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) {
      bomIdOptions[item.id] = bomMap.get(item.itemCode) ?? [];
    }

    const rows = items.map(dbContractReviewToRow);

    return NextResponse.json({
      headers: CONTRACT_REVIEW_HEADERS,
      rows,
      ids: items.map((i) => i.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
      bomIdOptions,
      pnRatingOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}