import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  VERIFY_BOM_HEADERS,
  dbVerifyBomToRow,
} from "@/lib/gmd_lib/verify-bom-columns";

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

    const rows = items.map(dbVerifyBomToRow);

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
