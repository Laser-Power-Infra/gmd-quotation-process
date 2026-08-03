import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_REVIEW_HEADERS,
  dbContractReviewToRow,
} from "@/lib/gmd_lib/contract-review-columns";

export async function GET() {
  try {
    const items = await prisma.contractReview.findMany({
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

    const rows = items.map(dbContractReviewToRow);

    return NextResponse.json({
      headers: CONTRACT_REVIEW_HEADERS,
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
