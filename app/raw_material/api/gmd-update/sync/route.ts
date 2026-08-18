import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchGMDUpdateSheet,
  fetchStockPhysicalSheet,
} from "@/lib/gmd_lib/google-sheets";
import { sheetRowToDbItem } from "@/lib/gmd_lib/mapSheetRow";

const ERP_CODE_IDX = 0;
const AVAILABLE_STOCK_IDX = 11;

export async function POST() {
  try {
    const data = await fetchGMDUpdateSheet();
    const stockMap = await fetchStockPhysicalSheet();
    // console.log("////////////////////////////////////" ,stockMap)
    const syncedAt = new Date();

    const mergedRows = data.rows.map((row) => {
      const erpCode = String(row[ERP_CODE_IDX] ?? "").trim();
      const stockVal = stockMap[erpCode];
      if (stockVal) {
        const newRow = [...row];
        newRow[AVAILABLE_STOCK_IDX] = stockVal;
        return newRow;
      }
      return row;
    });

    const dbItems = mergedRows.map((row) => sheetRowToDbItem(row, syncedAt));

    await prisma.$transaction([
      // prisma.gMDUpdateItem.deleteMany(),
      prisma.gMDUpdateItem.createMany({ data: dbItems }),
    ]);

    return NextResponse.json({ syncedAt, count: data.rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
