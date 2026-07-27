import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CANONICAL_COLUMNS } from "@/lib/gmd_lib/sheet-columns";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";

export async function GET() {
  try {
    const items = await prisma.gMDUpdateItem.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        erpItemCode: true,
        itemNameAuto: true,
        l1: true,
        l2ValveType: true,
        l3Dia: true,
        l7Dimension: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
        l8ItemCategory: true,
        um: true,
        conv1: true,
        pcsWgt: true,
        aum: true,
        availableStock: true,
        cost: true,
        hsnCode: true,
        conv2: true,
        majorMarking: true,
        newItemStatus: true,
        currentStatus: true,
        rmType: true,
        syncedAt: true,
      },
    });

    const syncedAt = items.length > 0 ? items[0].syncedAt : null;
    const headers = CANONICAL_COLUMNS;
    const rows = items.map(dbItemToRow);

    return NextResponse.json({ headers, rows, syncedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
