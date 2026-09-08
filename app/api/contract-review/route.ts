import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_REVIEW_HEADERS,
  dbContractReviewToRow,
} from "@/lib/gmd_lib/contract-review-columns";
import { getBatchDistinctBomIds } from "@/lib/verifyBomLookup";

export async function GET() {
  try {
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
