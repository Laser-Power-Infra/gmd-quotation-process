"use server";
import { requireAccess } from "@/lib/access";

import {
  getSerialDimension,
  listCodeOptions,
  listPhysicalStockFacet,
  listPhysicalStockPage,
  saveSerialDimension,
  updatePhysicalStockField,
  type StockTableQuery,
} from "@gmd/physical-stock/server";
import { pickFlange, standardFromFlange, type DimensionValues } from "@gmd/physical-stock/dimensions";
import { prisma } from "@/lib/prisma";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { ActionResult, PhysicalStockPageData, PhysicalStockRow } from "@gmd/physical-stock/types";
import type { TableQuery } from "@gmd/ui/components/data-table/types";
import { stockPrisma } from "@/lib/stockPrisma";
import { computeStockAllocation } from "@gmd/stock-allocation/server";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import {
  costForPhysicalStockBom,
  derivePhysicalStockByCodes,
} from "@/lib/gmd_lib/physical-stock-derive";

// Physical stock in this app is public (no auth), as before the move to
// @gmd/physical-stock. Flags are evaluated again inside every action: the UI
// hiding a control is cosmetic, these checks protect the data.

const code = (erp: string | null) => (erp ?? "").trim().toUpperCase();

async function guarded<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await requireAccess();
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One filtered/sorted page plus the BOM ID options (quotation DB) of the rows on it. */
export async function loadPage(query: TableQuery): Promise<ActionResult<PhysicalStockPageData>> {
  return guarded(async () => {
    const page = await listPhysicalStockPage(query as StockTableQuery, {
      duplicates: (await getPhysicalStockFlags()).duplicateErpHighlight,
    });
    const derivations = await derivePhysicalStockByCodes(page.rows.map((r) => code(r.erp_code)));
    const bomIdOptions: Record<string, string[]> = {};
    for (const row of page.rows) bomIdOptions[row.id] = derivations.get(code(row.erp_code))?.bomIds ?? [];
    // Order-wise allocation per stock row; a failure leaves the columns unknown (null).
    let allocByStock: Map<string, PhysicalStockRow["allocations"]> | null = null;
    try {
      allocByStock = new Map();
      for (const a of (await computeStockAllocation()).allocations) allocByStock.set(a.stockId, [...(allocByStock.get(a.stockId) ?? []), a]);
    } catch (err) {
      console.error("[physical-stock] allocation lookup failed", err);
      allocByStock = null;
    }
    const rows = page.rows.map((row) => ({ ...row, allocations: allocByStock ? (allocByStock.get(row.id) ?? []) : null }));
    return { ...page, rows, meta: { ...page.meta!, bomIdOptions } };
  });
}

export async function loadFacet(field: string, query: TableQuery) {
  return guarded(() => listPhysicalStockFacet(field, query as StockTableQuery));
}

/** New Item picker codes; empty until the db-stock migration and first hourly sync. */
export async function loadCodeOptions() {
  return guarded(listCodeOptions);
}

export async function updateField(id: string, field: string, value: string | null) {
  await requireAccess();
  return updatePhysicalStockField(id, field, value, editableFieldsFor(await getPhysicalStockFlags()));
}

export async function updateBomId(
  id: string,
  bomId: string | null,
): Promise<ActionResult<Partial<PhysicalStockRow>>> {
  await requireAccess();
  if (!(await getPhysicalStockFlags()).editableColumns.includes("BOM ID")) {
    return { success: false, error: "Not allowed in this app." };
  }
  try {
    const row = await stockPrisma.physicalStock.findUnique({ where: { id }, select: { erp_code: true } });
    if (!row) throw new Error("Physical stock row not found.");

    const value = bomId?.trim() || null;
    const erp = code(row.erp_code);
    const derivation = erp ? (await derivePhysicalStockByCodes([erp])).get(erp) : undefined;
    if (value && derivation && derivation.bomIds.length > 0 && !derivation.bomIds.includes(value)) {
      throw new Error("Selected BOM ID is not in available options.");
    }

    // Cost follows the selected BOM via the DB-maintained FullItem.cost
    // (fallback RawMaterial.cost). Clearing the BOM falls back to the code cost.
    const cost = value ? await costForPhysicalStockBom(erp, value) : (derivation?.maxCost ?? null);

    await stockPrisma.physicalStock.update({ where: { id }, data: { bom_id: value, cost } });
    return { success: true, data: { bom_id: value, cost } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Saved dimensions + the Technicals > Flange standard (pre-fill) for one serial-no row. */
export async function getSerialDimensions(id: string) {
  try {
    await requireAccess();
    const row = await stockPrisma.physicalStock.findUnique({ where: { id } });
    if (!row) throw new Error("Physical stock row not found.");
    const flange = pickFlange(await prisma.flange.findMany(), row);
    return {
      success: true as const,
      data: { saved: await getSerialDimension(id), standard: flange ? standardFromFlange(flange) : null },
    };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Inspector confirms/edits the values; standard is re-derived server-side for the tolerance flags. */
export async function saveSerialDimensions(id: string, values: DimensionValues) {
  await requireAccess();
  const row = await stockPrisma.physicalStock.findUnique({ where: { id } });
  if (!row) return { success: false as const, error: "Physical stock row not found." };
  const flange = pickFlange(await prisma.flange.findMany(), row);
  return saveSerialDimension(id, values, flange ? standardFromFlange(flange) : null);
}
