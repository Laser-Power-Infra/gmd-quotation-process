"use server";
import { requireAccess } from "@/lib/access";

import { getSerialDimension, listCodeOptions, listPhysicalStock, saveSerialDimension, updatePhysicalStockField } from "@gmd/physical-stock/server";
import { pickFlange, standardFromFlange, type DimensionValues } from "@gmd/physical-stock/dimensions";
import { prisma } from "@/lib/prisma";
import { incomingFromForItems, inTransitForItems } from "@gmd/purchase/server";
import { editableFieldsFor } from "@gmd/physical-stock/flags";
import type { ActionResult, PhysicalStockRow } from "@gmd/physical-stock/types";
import { stockPrisma } from "@/lib/stockPrisma";
import { getPhysicalStockFlags } from "@/lib/physical-stock-flags";
import {
  costForPhysicalStockBom,
  derivePhysicalStockByCodes,
} from "@/lib/gmd_lib/physical-stock-derive";

// Physical stock in this app is public (no auth), as before the move to
// @gmd/physical-stock. Flags are evaluated again inside every action: the UI
// hiding a control is cosmetic, these checks protect the data.

const code = (erp: string | null) => (erp ?? "").trim().toUpperCase();

/** Rows plus per-row BOM ID options from the quotation DB BOM relations. */
export async function load() {
  try {
    await requireAccess();
    const items = await listPhysicalStock();
    const derivations = await derivePhysicalStockByCodes(items.map((i) => code(i.erp_code)));
    const bomIdOptions: Record<string, string[]> = {};
    for (const item of items) bomIdOptions[item.id] = derivations.get(code(item.erp_code))?.bomIds ?? [];

    // Ordered but not yet received, by ERP code. A failure here must not take
    // the stock page down with it: the column falls back to blank (unknown).
    let inTransit = new Map<string, number>();
    let incomingFrom = new Map<string, string>();
    try {
      const codes = items.map((i) => (i.erp_code ?? "").trim());
      [inTransit, incomingFrom] = await Promise.all([inTransitForItems(codes), incomingFromForItems(codes)]);
    } catch (err) {
      console.error("[physical-stock] in-transit lookup failed", err);
    }
    const withInTransit = items.map((item) => ({
      ...item,
      in_transit: inTransit.get((item.erp_code ?? "").trim()) ?? null,
      incoming_from: incomingFrom.get((item.erp_code ?? "").trim()) ?? null,
    }));

    // Table missing until the db-stock migration is deployed: the dialog falls back to generating.
    const codeOptions = await listCodeOptions().catch((err) => {
      console.error("[physical-stock] code options lookup failed", err);
      return undefined;
    });
    return { success: true as const, data: { items: withInTransit, bomIdOptions, codeOptions } };
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : String(err) };
  }
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
