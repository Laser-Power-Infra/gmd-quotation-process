import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SUPPLY_DISPLAY_HEADERS, buildSupplyRow } from "@/lib/supplyRows";
import { costLines, supplyCostInput } from "@/lib/lineCost-server";

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const [items, utilityRows] = await Promise.all([
      prisma.supplyHistoryItem.findMany({
        orderBy: { syncedAt: "desc" },
        include: {
          bomLinks: {
            select: {
              bomItemId: true,
              bom: { select: { bomId: true } },
              bomItem: { select: { cost: true } },
              rawMaterial: { select: { cost: true } },
            },
          },
          selectedBomItem: {
            select: {
              id: true,
              cost: true,
              bom: { select: { bomId: true } },
              rawMaterial: { select: { cost: true } },
            },
          },
        },
      }),
      prisma.lookupOption.findMany({
        where: { type: "UTILITY", isActive: true },
        orderBy: [{ sortOrder: "asc" }],
        select: { value: true },
      }),
    ]);

    const utilityOptions = utilityRows
      .map((row) => row.value)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const lastSynced =
      items.length > 0
        ? items.reduce(
            (latest: Date, item) =>
              item.syncedAt > latest ? item.syncedAt : latest,
            items[0].syncedAt,
          )
        : null;

    // shortcut: costs the whole table on every call, move to the planned RabbitMQ job (stored costs) if this route gets real traffic
    const costs = await costLines(items.map(supplyCostInput));
    const rows: unknown[][] = [];
    const bomIdOptions: Record<string, string[]> = {};
    for (const [i, item] of items.entries()) {
      const built = buildSupplyRow(item, costs[i]);
      rows.push(built.row);
      bomIdOptions[item.id] = built.bomIdOptions;
    }

    return NextResponse.json({
      headers: SUPPLY_DISPLAY_HEADERS,
      rows,
      ids: items.map((item) => item.id),
      totalRows: rows.length,
      syncedAt: lastSynced?.toISOString() ?? null,
      utilityOptions,
      bomIdOptions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
