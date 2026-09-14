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

    const existingCodes = new Set(
      (
        await prisma.gMDUpdateItem.findMany({
          select: { erpItemCode: true },
        })
      )
        .map((item) => (item.erpItemCode ?? "").trim())
        .filter(Boolean),
    );

    const queued = new Set<string>();
    const toCreate = dbItems.filter((item) => {
      const code = (item.erpItemCode ?? "").trim();
      if (!code) return false;
      if (existingCodes.has(code) || queued.has(code)) return false;
      queued.add(code);
      return true;
    });

    if (toCreate.length > 0) {
      await prisma.gMDUpdateItem.createMany({ data: toCreate });
    }

    const createdCodes = toCreate.map((item) =>
      (item.erpItemCode ?? "").trim(),
    );

    console.log("\n===== [SYNC] GMD UPDATION SHEET → DB =====");
    console.log(`[SYNC] Synced at      : ${syncedAt.toISOString()}`);
    console.log(`[SYNC] Rows in sheet  : ${data.rows.length}`);
    console.log(`[SYNC] Already in DB  : ${existingCodes.size}`);
    console.log(`[SYNC] Created (new)  : ${toCreate.length}`);
    console.log(`[SYNC] Skipped        : ${data.rows.length - toCreate.length} (already present / empty code)`);
    if (createdCodes.length > 0) {
      console.log(`[SYNC] New ERP codes  : ${createdCodes.length}`);
      createdCodes.forEach((code, i) =>
        console.log(`[SYNC]   ${i + 1}. ${code}`),
      );
    } else {
      console.log("[SYNC] No new ERP codes — DB is up to date.");
    }
    console.log("===== [SYNC] DONE =====\n");

    return NextResponse.json({
      syncedAt,
      created: toCreate.length,
      skipped: data.rows.length - toCreate.length,
      totalInSheet: data.rows.length,
      createdCodes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
