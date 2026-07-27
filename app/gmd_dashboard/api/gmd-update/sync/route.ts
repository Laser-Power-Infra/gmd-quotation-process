import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchGMDUpdateSheet } from "@/lib/gmd_lib/google-sheets";
import { sheetRowToDbItem } from "@/lib/gmd_lib/mapSheetRow";

export async function POST() {
  try {
    const data = await fetchGMDUpdateSheet();
    const syncedAt = new Date();

    const dbItems = data.rows.map((row) => sheetRowToDbItem(row, syncedAt));

    await prisma.$transaction([
      prisma.gMDUpdateItem.deleteMany(),
      prisma.gMDUpdateItem.createMany({ data: dbItems }),
    ]);

    return NextResponse.json({ syncedAt, count: data.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
