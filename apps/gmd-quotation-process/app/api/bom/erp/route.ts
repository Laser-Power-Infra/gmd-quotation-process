import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOM_MAST_ERP_GID,
  BOM_MAST_ERP_SPREADSHEET_ID,
  findColumn,
  readSheetTabByGid,
} from "@/lib/gmd_lib/bomMastErp";

export const dynamic = "force-dynamic";

/**
 * GET /api/bom/erp — the ERP BOM tab on /bom.
 *
 * Reads `BOM MAST ERP` straight from the sheet, on demand, like the page's
 * ItemName (C) check does: the hourly bom-mast job only stores the BOM_ID ->
 * ITEM_CODE -> RM_ITEM_CODE links, not BOM_DATE / QTYUNIT / UM / TO_DATE, and
 * those are what this tab is for. Item names come from the DB (FullItem /
 * RawMaterial) so the page shows plain names next to the codes.
 */
export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const { headers, rows } = await readSheetTabByGid(BOM_MAST_ERP_SPREADSHEET_ID, BOM_MAST_ERP_GID);
    const itemIdx = findColumn(headers, "ITEM_CODE");
    const rmIdx = findColumn(headers, "RM_ITEM_CODE");

    const [fullItems, rawMaterials] = await Promise.all([
      prisma.fullItem.findMany({ select: { itemCode: true, itemName: true } }),
      prisma.rawMaterial.findMany({ select: { erpItemCode: true, itemNameAuto: true } }),
    ]);
    const names = new Map<string, string>();
    for (const f of fullItems) if (f.itemCode && f.itemName) names.set(f.itemCode.trim().toUpperCase(), f.itemName);
    // RawMaterial wins for components, matching RM ITEM NAME on the Verify BOM tab.
    for (const r of rawMaterials)
      if (r.erpItemCode && r.itemNameAuto) names.set(r.erpItemCode.trim().toUpperCase(), r.itemNameAuto);
    const nameOf = (row: string[], idx: number) =>
      idx < 0 ? "" : names.get(String(row[idx] ?? "").trim().toUpperCase()) ?? "";

    // ITEM NAME after ITEM_CODE, RM ITEM NAME after RM_ITEM_CODE; every sheet column kept.
    const outHeaders: string[] = [];
    headers.forEach((h, i) => {
      outHeaders.push(h);
      if (i === itemIdx) outHeaders.push("ITEM NAME");
      if (i === rmIdx) outHeaders.push("RM ITEM NAME");
    });
    const outRows = rows
      .filter((r) => r.some((c) => String(c ?? "").trim()))
      .map((r) => {
        const out: string[] = [];
        headers.forEach((_, i) => {
          out.push(String(r[i] ?? "").trim());
          if (i === itemIdx) out.push(nameOf(r, itemIdx));
          if (i === rmIdx) out.push(nameOf(r, rmIdx));
        });
        return out;
      });

    return NextResponse.json({
      headers: outHeaders,
      rows: outRows,
      ids: outRows.map((_, i) => `erp-${i}`),
      totalRows: outRows.length,
      // Live read, so "last updated" is now.
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read BOM MAST ERP.";
    console.error("[bom/erp] read failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
