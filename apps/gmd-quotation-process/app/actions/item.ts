"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { syncAvailableBomIds, maybeUpdateProductCostFromNewCode } from "@/lib/itemBomSync";
import { prisma } from "@/lib/prisma";
import { recalculateItem, serializeItem, autoDetectItemType, getItemNameMerge } from "@/lib/costCalculator";
import { resolveItemCategory } from "@/lib/itemCategoryResolver";
import { correctItemType } from "@/lib/itemTypePatterns";
import { DETAILS_FIELDS, pnFromName, type AutoFillChange, type DetailsField } from "@/lib/detailsCheck";
import { validateVaPercent, getDefaultVaPercent } from "@/lib/vaValidation";
import { recomputeItemCodeForValues, fetchBomIdSet, refreshItemCodeForItem, syncGmdItemCodes, clearBomIdCache } from "@/lib/gmdItemCodeLookup";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M, getBomEntry, getCachedBomRows, clearBomCache } from "@/lib/gmdBomCostLookup";
import { update2to1CostForItems, buildRawMaterialsCostMap, clear2to1BomCache } from "@/lib/gmd2to1CostLookup";
import { getDistinctBomIds, getNoUseBomIdSet, clearVerifyBomCache, findBomForItem, getBomCandidates } from "@/lib/verifyBomLookup";
import { getRmStockMap, getRmTypeMap, syncDirectM2MAvailableStock } from "@/lib/directM2MStockLookup";
import { syncDeliveryScheduleForItem } from "@/lib/deliverySchedule";
import { resolveImportedInhouse } from "@/lib/importInhouseMapping";

/**
 * Back-calculates and populates BOM ID from a selected rmType on an EnquiryItem.
 * Matches candidate BOMs from VerifyBom whose raw material (rmItemCode) in GMDUpdateItem has matching rmType.
 */
async function maybeBackCalculateBomFromRmType(itemId: string, selectedRmType: string | null) {
  if (!selectedRmType || !selectedRmType.trim()) return null;
  const targetType = selectedRmType.trim().toUpperCase();

  const current = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      erpItemCode: true,
      bomId: true,
      productCost: true,
      itemType: true,
      moc: true,
      size: true,
      pnRating: true,
      operationType: true,
    },
  });
  if (!current) return null;

  // Only proceed if bomId is currently blank
  if (current.bomId && current.bomId.trim() !== "") return null;

  let itemCode = current.erpItemCode;
  // If erpItemCode is missing, try to resolve it from the 5 fields
  if (!itemCode && (current.itemType || current.moc || current.size || current.pnRating || current.operationType)) {
    const recomputed = await recomputeItemCodeForValues(
      itemId,
      {
        itemType: current.itemType,
        moc: current.moc,
        size: current.size,
        pnRating: current.pnRating,
        operationType: current.operationType,
      },
      null
    );
    if (recomputed.newCode) {
      itemCode = recomputed.newCode;
      await syncAvailableBomIds(itemId, itemCode);
    }
  }

  if (!itemCode) return null;

  // Look up candidate BOM components for this item code (excluding NO USE)
  const candidates = await getBomCandidates(itemCode, { excludeNoUse: true });
  if (candidates.length === 0) return null;

  const rmCodes = [...new Set(candidates.map((c) => c.rmItemCode).filter(Boolean))] as string[];
  const rmTypeMap = await getRmTypeMap(rmCodes);

  // Find the candidate whose raw material has the matching rmType
  const match = candidates.find((c) => {
    if (!c.rmItemCode) return false;
    const typeVal = rmTypeMap.get(c.rmItemCode);
    return typeVal && typeVal.trim().toUpperCase() === targetType;
  });

  if (!match) return null;

  const bomType = match.bomIdType || DIRECT_M2M;
  const dataToUpdate: any = {
    bomId: match.bomId,
    bomType,
    rmItemCode: match.rmItemCode,
  };

  if (bomType === DIRECT_M2M && match.rmItemCode) {
    const stockMap = await getRmStockMap([match.rmItemCode]);
    const stock = stockMap.get(match.rmItemCode);
    if (stock !== undefined) dataToUpdate.availableStock = stock;
  }

  await prisma.enquiryItem.update({
    where: { id: itemId },
    data: dataToUpdate,
  });

  // If productCost was null, auto-fill it and recalculate
  if (current.productCost === null && match.rmItemCode) {
    let cost: number | undefined;
    const rawMap = await buildRawMaterialsCostMap([match.rmItemCode]);
    cost = rawMap.get(match.rmItemCode);
    if (cost === undefined) {
      const supplyMap = await buildRmCostMap([match.rmItemCode]);
      cost = supplyMap.get(match.rmItemCode);
    }
    if (cost !== undefined && cost !== null) {
      const recalc = await recalculateItem(itemId, { productCost: cost });
      if (recalc) return recalc;
    }
  }

  const updated = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
  return updated ? serializeItem(updated) : null;
}

// Latest VA% / quoted rate / validation changes for one item (History dialog).
export async function getItemChangeLogAction(itemId: string) {
  await requireAccess();
  try {
    const rows = await prisma.itemChangeLog.findMany({ where: { itemId }, orderBy: { createdAt: "desc" }, take: 50 });
    return { success: true, data: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to load history." };
  }
}

// Update a specific field of an enquiry item directly (for inline cell editing)
export async function updateItemFieldAction(
  itemId: string,
  field: string,
  value: any
) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const prevFull = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
      select: {
        enquiryId: true,
        itemName: true,
        itemType: true,
        moc: true,
        size: true,
        pnRating: true,
        operationType: true,
        erpItemCode: true,
        productCost: true,
        bomId: true,
        validation: true,
        vaPercent: true,
        quotedRate: true,
        [field]: true,
      },
    });
    if (!prevFull) {
      return { success: false, error: "Item not found." };
    }
    const oldVal = (prevFull as any)[field];
    const oldCode = prevFull.erpItemCode ?? null;
    const oldProductCost = prevFull.productCost ?? null;
    console.log(`[Server] updateItemField item=${itemId} field=${field} old="${oldVal}" new="${value}"`);

    // Enforce frozen pricing columns after one-time PDF (apm === "Yes" && offerPdfGeneratedAt set)
    {
      const { FROZEN_ITEM_FIELD_SET, isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      if (FROZEN_ITEM_FIELD_SET.has(field)) {
        const parent = await prisma.enquiry.findUnique({
          where: { id: (prevFull as any).enquiryId },
          select: { apm: true, offerPdfGeneratedAt: true },
        });
        if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
          return { success: false, error: "Rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
        }
      }
    }

    // Validation=Yes freezes the rate block: VA% and quotedRate are derived, not editable.
    if ((field === "quotedRate" || field === "vaPercent") && (prevFull as any).validation === "Yes") {
      return {
        success: false,
        error: "Rate & VA% are locked for validated items (Validation = Yes) — VA% follows cost changes automatically.",
      };
    }

    let parsedVal: any = value;
    if (field === "others") {
      if (value === null || value === "") parsedVal = [];
      else if (Array.isArray(value)) parsedVal = value;
      else if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          parsedVal = Array.isArray(parsed) ? parsed : [String(value)];
        } catch { parsedVal = [String(value)]; }
      } else parsedVal = [];
    } else if (field === "vaPercent" && value !== null) {
      const num = parseFloat(String(value).replace(/%/g, ""));
      parsedVal = !isNaN(num) ? String(num) : null;
    } else if (["quantity", "productCost", "cost", "discount"].includes(field) && value !== null) {
      parsedVal = parseFloat(String(value).replace(/,/g, "")) || 0;
    }

    let updatedItem;
    if (["productCost", "extension", "bypass", "quantity", "vaPercent", "quotedRate", "cost"].includes(field)) {
      const updates: any = {};
      if (field === "vaPercent") {
        updates.vaPercent = parsedVal !== null ? parseFloat(parsedVal) : null;
      } else if (field === "quotedRate") {
        updates.quotedRate = parsedVal !== null ? parseFloat(String(parsedVal).replace(/,/g, "")) : null;
      } else {
        updates[field] = parsedVal;
      }
      updatedItem = await recalculateItem(itemId, updates);
    } else {
      const updateData: any = { [field]: parsedVal };
      if (field === "deliverySchedule") {
        // A hand-picked value is the source of truth; clearing it hands the row
        // back to the sync.
        updateData.deliveryScheduleOverride = !!(parsedVal && String(parsedVal).trim());
      }
      if (field === "itemName") {
        const currentItem = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { itemName: true, itemType: true, moc: true, itemTypeSource: true, mocSource: true, size: true, pnRating: true, bypass: true },
        });
        console.log(`[Server] itemName changed: "${currentItem?.itemName}" â†’ "${parsedVal}"`);
        const resolved = await resolveItemCategory({
          itemName: parsedVal,
          sheetItemType: currentItem?.itemTypeSource === "sheet" ? currentItem.itemType : null,
          sheetMoc: currentItem?.mocSource === "sheet" ? currentItem.moc : null,
          sheetSize: null,
          sheetPnRating: null,
        });
        updateData.itemType = resolved.itemType;
        updateData.moc = resolved.moc;
        updateData.pnRating = resolved.pnRating;
        updateData.itemTypeSource = resolved.itemTypeSource;
        updateData.mocSource = resolved.mocSource;
        updateData.size = resolved.size;
        // Bypass gating: sync bypass with resolved value ( "-" when no mention )
        if (resolved.bypass !== currentItem?.bypass) {
          updateData.bypass = resolved.bypass;
        }
        console.log(`[Server] Re-resolved: itemType="${resolved.itemType}" moc="${resolved.moc}" size="${resolved.size}" pnRating="${resolved.pnRating}" bypass="${resolved.bypass}"`);
      } else if (field === "itemType") {
        updateData.itemTypeSource = "sheet";
      } else if (field === "moc") {
        updateData.mocSource = "sheet";
      }
      let dbItem = await prisma.enquiryItem.update({
        where: { id: itemId },
        data: updateData,
      });

      // Re-derive import/in-house classification when a source field changes.
      // A direct `importedInhouse` edit is left untouched (manual override).
      if (field === "itemType" || field === "size" || field === "itemName") {
        const derived = resolveImportedInhouse(dbItem.itemType, dbItem.size, dbItem.itemName);
        if (derived !== dbItem.importedInhouse) {
          dbItem = await prisma.enquiryItem.update({
            where: { id: itemId },
            data: { importedInhouse: derived },
          });
        }
      }

      // If rmType changed and bomId is blank, back-calculate and fill bomId
      if (field === "rmType" && parsedVal) {
        try {
          const backCalculated = await maybeBackCalculateBomFromRmType(itemId, parsedVal);
          if (backCalculated) {
            dbItem = (await prisma.enquiryItem.findUnique({ where: { id: itemId } })) as any;
          }
        } catch (e) {
          console.warn(`[updateItemField] back-calculate bomId from rmType failed for ${itemId}:`, e);
        }
      }

      // If bypass changed via itemName gate, recalculate cost atomically
      if (updateData.bypass !== undefined) {
        const recalc = await recalculateItem(itemId, { bypass: updateData.bypass });
        if (recalc) {
          dbItem = await prisma.enquiryItem.findUnique({ where: { id: itemId } }) as any;
        }
      }

      const MERGE_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass", "others", "itemName"];
      if (MERGE_FIELDS.includes(field)) {
        const merged = getItemNameMerge(dbItem);
        dbItem = await prisma.enquiryItem.update({
          where: { id: itemId },
          data: { itemNameMerge: merged === "" ? null : merged },
        });
      }

      updatedItem = serializeItem(dbItem);

      if (updatedItem && !updatedItem.vaPercent && (updatedItem.itemType || updatedItem.size)) {
        const defaultVa = getDefaultVaPercent(updatedItem.itemType, updatedItem.size);
        if (defaultVa !== null) {
          updatedItem = await recalculateItem(itemId, { vaPercent: defaultVa });
        }
      }
    }

    const after: Record<string, unknown> | null = updatedItem;
    if (after) {
      const { logItemChanges } = await import("@/lib/itemChangeLog");
      await logItemChanges(
        (["vaPercent", "quotedRate", "validation"] as const).map((f) => ({
          itemId,
          enquiryId: prevFull.enquiryId,
          field: f,
          oldValue: (prevFull as any)[f],
          newValue: after[f],
        })),
      );
    }

    if (["vaPercent", "quotedRate", "productCost", "extension", "bypass"].includes(field) && updatedItem) {
      const itemWithDocket = await prisma.enquiryItem.findUnique({
        where: { id: itemId },
        include: { enquiry: { select: { docketNumber: true } } },
      });
      if (itemWithDocket?.enquiry) {
        const vaNum = updatedItem.vaPercent !== null && updatedItem.vaPercent !== undefined ? Number(updatedItem.vaPercent) : null;
        const result = validateVaPercent(updatedItem.itemType, updatedItem.size, vaNum);
        if (!result.isValid && result.maxVaPercent !== null && vaNum !== null) {
          const alertPayload = {
            docketNumber: itemWithDocket.enquiry.docketNumber,
            itemName: updatedItem.itemName,
            itemNameMerge: updatedItem.itemNameMerge || null,
            itemType: updatedItem.itemType,
            size: updatedItem.size,
            vaPercent: vaNum,
            maxVaPercent: result.maxVaPercent,
          };
          import("@/lib/services/n8nWebhook").then(({ sendVaAlert }) => {
            sendVaAlert(alertPayload);
          });
        }
      }
    }

    // Auto-recompute erpItemCode if derived fields changed, and cascade productCost if code changed and productCost was null
    const CODE_DERIVED_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "itemName"];
    if (CODE_DERIVED_FIELDS.includes(field) && updatedItem) {
      try {
        const fresh = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { itemType: true, moc: true, size: true, pnRating: true, operationType: true, erpItemCode: true, productCost: true },
        });
        if (fresh) {
          const recomputed = await recomputeItemCodeForValues(
            itemId,
            {
              itemType: fresh.itemType,
              moc: fresh.moc,
              size: fresh.size,
              pnRating: fresh.pnRating,
              operationType: fresh.operationType,
            },
            fresh.erpItemCode
          );
          // If code actually changed, sync availableBomIds and re-align/clear stale bomId
          if (recomputed.changed) {
            const afterCode = await prisma.enquiryItem.findUnique({
              where: { id: itemId },
              select: { productCost: true, erpItemCode: true, availableBomIds: true, bomId: true },
            });
            let validCandidates: string[] = [];
            if (afterCode?.erpItemCode) {
              validCandidates = await syncAvailableBomIds(itemId, afterCode.erpItemCode);
            } else {
              await syncAvailableBomIds(itemId, null);
            }

            const currentBomId = afterCode?.bomId;
            const isStaleBom = currentBomId && !validCandidates.includes(currentBomId);

            if (isStaleBom || !currentBomId) {
              if (validCandidates.length === 1 && afterCode?.erpItemCode) {
                const candidateBom = validCandidates[0];
                const vbRow = await findBomForItem(afterCode.erpItemCode, candidateBom);
                if (vbRow?.rmItemCode) {
                  const bomType = vbRow.bomIdType || DIRECT_M2M;
                  const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
                  const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
                  const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
                  if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
                  if (bomType === DIRECT_M2M) {
                    const stockMap = await getRmStockMap([vbRow.rmItemCode]);
                    const stock = stockMap.get(vbRow.rmItemCode);
                    if (stock !== undefined) dataToUpdate.availableStock = stock;
                  }
                  await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });

                  // Re-derive cost for the new raw material
                  const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
                  let cost = rawMap.get(vbRow.rmItemCode);
                  if (cost === undefined) {
                    const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
                    cost = supplyMap.get(vbRow.rmItemCode);
                  }
                  if (cost !== undefined && cost !== null) {
                    await recalculateItem(itemId, { productCost: cost });
                  }
                }
              } else {
                // 0 or >1 candidates: clear stale BOM linkage so dropdown or blank shows
                await prisma.enquiryItem.update({
                  where: { id: itemId },
                  data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
                });
              }
            } else {
              const refreshedAfterSync = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { productCost: true, erpItemCode: true } });
              if (refreshedAfterSync?.erpItemCode && refreshedAfterSync.productCost === null) {
                await maybeUpdateProductCostFromNewCode(itemId, refreshedAfterSync.erpItemCode, refreshedAfterSync.productCost);
              }
            }

            // Refresh updatedItem to return latest
            const latest = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
            if (latest) updatedItem = serializeItem(latest);
          }
        }
      } catch (e) {
        console.warn(`[updateItemField] auto-recompute code failed for ${itemId}:`, e);
      }
    }

    // Auto-sync availableBomIds and re-align bomId if erpItemCode was updated directly
    if (field === "erpItemCode" && updatedItem) {
      try {
        const itemCodeVal = parsedVal ? String(parsedVal).trim() : null;
        let validCandidates: string[] = [];
        if (itemCodeVal) {
          validCandidates = await syncAvailableBomIds(itemId, itemCodeVal);
        } else {
          await syncAvailableBomIds(itemId, null);
        }

        const freshItem = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { bomId: true },
        });
        const currentBomId = freshItem?.bomId;
        const isStaleBom = currentBomId && !validCandidates.includes(currentBomId);

        if (isStaleBom || !currentBomId) {
          if (validCandidates.length === 1 && itemCodeVal) {
            const candidateBom = validCandidates[0];
            const vbRow = await findBomForItem(itemCodeVal, candidateBom);
            if (vbRow?.rmItemCode) {
              const bomType = vbRow.bomIdType || DIRECT_M2M;
              const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
              const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
              const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
              if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
              if (bomType === DIRECT_M2M) {
                const stockMap = await getRmStockMap([vbRow.rmItemCode]);
                const stock = stockMap.get(vbRow.rmItemCode);
                if (stock !== undefined) dataToUpdate.availableStock = stock;
              }
              await prisma.enquiryItem.update({ where: { id: itemId }, data: dataToUpdate });

              const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
              let cost = rawMap.get(vbRow.rmItemCode);
              if (cost === undefined) {
                const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
                cost = supplyMap.get(vbRow.rmItemCode);
              }
              if (cost !== undefined && cost !== null) {
                await recalculateItem(itemId, { productCost: cost });
              }
            }
          } else {
            await prisma.enquiryItem.update({
              where: { id: itemId },
              data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
            });
          }
        }
        const latest = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
        if (latest) updatedItem = serializeItem(latest);
      } catch (e) {
        console.warn(`[updateItemField] erpItemCode bom sync failed for ${itemId}:`, e);
      }
    }

    // Auto-set delivery schedule when any input to the schedule logic changes
    // (quantity, availableStock, size, itemType, itemName, import/in-house class,
    // or an item code / BOM change that rewrites availableStock). A blank manual
    // value also lands here so the row goes back to being derived.
    if (["quantity", "availableStock", "size", "itemType", "itemName", "importedInhouse", "erpItemCode", "bomId", "deliverySchedule"].includes(field)) {
      await syncDeliveryScheduleForItem(itemId);
    }

    // Always fetch authoritative latest record directly from database before returning
    const finalItem = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
    });

    return { success: true, data: finalItem ? serializeItem(finalItem) : updatedItem };
  } catch (error: any) {
    console.error(`Error updating item ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${itemId}.` };
  }
}

// User selects a single bomId from availableBomIds dropdown â†’ persist to bomId/rmItemCode/bomType + optional cost
export async function selectBomIdAction(itemId: string, bomId: string | null) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const item = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { enquiryId: true, erpItemCode: true, productCost: true, availableBomIds: true } });
    if (!item) return { success: false, error: "Item not found." };
    // Guard frozen enquiries: bom selection mutates productCost/cost linkage
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const parent = await prisma.enquiry.findUnique({ where: { id: (item as any).enquiryId }, select: { apm: true, offerPdfGeneratedAt: true } });
      if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
        return { success: false, error: "Cannot change BOM: rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
      }
    }
    if (!item.erpItemCode) return { success: false, error: "Item has no Item Code." };
    if (bomId !== null && bomId !== "" && !item.availableBomIds.includes(bomId)) {
      return { success: false, error: "Selected BOM ID is not in available options." };
    }
    if (!bomId) {
      // Clear selection
      const cleared = await prisma.enquiryItem.update({ where: { id: itemId }, data: { bomId: null, rmItemCode: null, rmType: null, bomType: null } });
      return { success: true, data: serializeItem(cleared) };
    }
    const vbRow = await findBomForItem(item.erpItemCode, bomId);
    if (!vbRow) return { success: false, error: "BOM not found for this item code." };
    // Update bom linkage and available stock if DIRECT M2M
    const bomType = vbRow.bomIdType || DIRECT_M2M;
    const dataToUpdate: any = { bomId: vbRow.bomId, bomType, rmItemCode: vbRow.rmItemCode };
    if (vbRow.rmItemCode) {
      const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
      const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
      if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
    }
    if (bomType === DIRECT_M2M && vbRow.rmItemCode) {
      const stockMap = await getRmStockMap([vbRow.rmItemCode]);
      const stock = stockMap.get(vbRow.rmItemCode);
      if (stock !== undefined) dataToUpdate.availableStock = stock;
    }
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: dataToUpdate,
    });
    // The stock just written may change the promised schedule; recompute before returning the row.
    await syncDeliveryScheduleForItem(itemId);
    // Auto-fill productCost if blank
    // PRIORITY: Raw Materials wins; SupplyHistory fallback
    if (item.productCost === null && vbRow.rmItemCode) {
      let cost: number | undefined;
      const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
      cost = rawMap.get(vbRow.rmItemCode);
      if (cost === undefined) {
        const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
        cost = supplyMap.get(vbRow.rmItemCode);
      }
      if (cost !== undefined && cost !== null) {
        const recalc = await recalculateItem(itemId, { productCost: cost });
        if (recalc) return { success: true, data: recalc };
      }
    }
    const updated = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
    return { success: true, data: serializeItem(updated) };
  } catch (e: any) {
    console.error("[selectBomIdAction] failed:", e);
    return { success: false, error: e.message || "Failed to select BOM." };
  }
}

export type ItemCodeFetchFailure = {
  itemId: string;
  itemName: string;
  reason: string;
};

export type ItemCodeChange = {
  itemId: string;
  itemName: string;
  from: string | null;
  to: string;
};

// Fetch/refresh ERP item codes for multiple enquiry items (triggered via UI button).
// Every supplied item is re-derived from a freshly synced master snapshot, so a
// mapping changed in the GMD Item Creation Form is picked up rather than only
// filling blanks. A stored code is never nulled: when the master cannot vouch for
// a code (blank field, or combination it no longer lists) the row is left as-is and
// the item is reported as a failure.
export async function fetchErpItemCodesAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  const updatedItems: ReturnType<typeof serializeItem>[] = [];
  const failures: ItemCodeFetchFailure[] = [];
  const changes: ItemCodeChange[] = [];
  let fetched = 0;
  let changed = 0;
  let syncFailed = false;

  // Force a full master re-sync so edits made seconds ago are visible. On failure
  // the previous snapshot survives (the sync is an atomic wipe-and-replace) and we
  // carry on with it, flagging the degraded run to the UI.
  try {
    const { count } = await syncGmdItemCodes();
    console.log(`[fetchErpItemCodes] Re-synced ${count} master row(s) from the GMD Item Creation Form`);
    // Master snapshot changed: refresh the CURRENT REQT "N" marks.
    try {
      const { recomputeNotCurrentReqtMarks } = await import(
        "@/lib/contractReviewCurrentReqt"
      );
      const r = await recomputeNotCurrentReqtMarks();
      console.log(
        `[fetchErpItemCodes] CURRENT REQT marks: CR +${r.contractReview.marked}/-${r.contractReview.cleared}, items +${r.enquiryItem.marked}/-${r.enquiryItem.cleared}`,
      );
    } catch (e) {
      console.warn("[fetchErpItemCodes] current reqt mark failed:", e);
    }
  } catch (e) {
    syncFailed = true;
    console.error("[fetchErpItemCodes] Master sheet sync failed, using the existing snapshot:", e);
  }

  // Drop every cache derived from the master/BOM sheet so this run reads fresh data.
  clearBomIdCache();
  clearBomCache();
  clearVerifyBomCache();
  clear2to1BomCache();

  // Pre-warm BOM & BOM ID cache so gate checks don't fetch per item
  try {
    await Promise.all([getCachedBomRows(), fetchBomIdSet()]);
  } catch {}

  for (const itemId of itemIds) {
    try {
      const result = await refreshItemCodeForItem(itemId);

      if (result.changed && result.code) {
        // The code moved, so any bomId/bomType/rmItemCode/rmType/availableStock on
        // this row belonged to the OLD code. Clear them before re-deriving for the
        // new one. productCost is deliberately untouched here.
        await prisma.enquiryItem.update({
          where: { id: itemId },
          data: { bomId: null, bomType: null, rmItemCode: null, rmType: null, availableStock: null },
        });
        changed++;
        changes.push({
          itemId,
          itemName: result.itemName ?? itemId,
          from: result.oldCode,
          to: result.code,
        });
      }

      if (result.code) {
        // Repopulate availableBomIds from VerifyBom for the current code (idempotent).
        try { await syncAvailableBomIds(itemId, result.code); } catch {}
        // Re-derive BOM linkage and fill cost only when the code actually moved.
        // maybeUpdateProductCostFromNewCode only writes missing values, so an
        // existing productCost is never overwritten.
        if (result.changed) {
          await maybeUpdateProductCostFromNewCode(itemId, result.code, null);
        }
        const item = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
        if (item) {
          fetched++;
          updatedItems.push(serializeItem(item));
        }
      } else {
        failures.push({
          itemId,
          itemName: result.itemName ?? `Item ${itemId}`,
          reason: result.reason || "No matching code in master sheet.",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch ERP item code.";
      console.error(`Error fetching ERP item code for item ${itemId}:`, error);
      failures.push({
        itemId,
        itemName: `Item ${itemId}`,
        reason: message,
      });
    }
  }

  // Codes may have flipped NO -> YES during the loop above, so re-derive the
  // CURRENT REQT "N" marks now: a stale mark from the OLD code must not survive
  // a click that just moved the item to a current code. Best-effort only.
  try {
    const { recomputeNotCurrentReqtMarks } = await import(
      "@/lib/contractReviewCurrentReqt"
    );
    const r = await recomputeNotCurrentReqtMarks();
    console.log(
      `[fetchErpItemCodes] CURRENT REQT marks after refresh: CR +${r.contractReview.marked}/-${r.contractReview.cleared}, items +${r.enquiryItem.marked}/-${r.enquiryItem.cleared}`,
    );
  } catch (e) {
    console.warn("[fetchErpItemCodes] post-refresh current reqt mark failed:", e);
  }

  if (fetched === 0) {
    let detailedError: string;
    if (failures.length === 1) {
      detailedError = failures[0].reason;
    } else {
      const bulletList = failures
        .slice(0, 5)
        .map((f) => `â€¢ ${f.itemName.slice(0, 35)}: ${f.reason}`)
        .join("\n");
      const extra = failures.length > 5 ? `\n...and ${failures.length - 5} more item(s)` : "";
      detailedError = `${failures.length} item(s) could not be matched:\n${bulletList}${extra}`;
    }
    return { success: false, error: detailedError, data: { items: updatedItems, fetched: 0, changed, changes, failures, syncFailed } };
  }
  return { success: true, data: { items: updatedItems, fetched, changed, changes, failures, syncFailed } };
}

// Fill blank productCost from raw material (BOM DIRECT M2M) costs, triggered via UI button
// PRIORITY: Raw Materials (GMDUpdateItem.cost) wins; SupplyHistory is fallback. Fixes FSD040002 -> RSD110023 (4900)
export async function updateProductCostFromBomAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    // Guard frozen enquiries: productCost is a frozen column after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update product costs: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const bomRows = await fetchBomRows();
    const bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
    for (const r of bomRows) {
      bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
    }

    const rmCodes = [...new Set(bomRows.map((r) => r.rmItemCode))];
    // Raw Materials primary, SupplyHistory fallback (commented out primary supply path per requirement)
    const stockMap = await getRmStockMap(rmCodes);
    const rmTypeMap = await getRmTypeMap(rmCodes);
    const rawCostMap = await buildRawMaterialsCostMap(rmCodes);
    let costMap = rawCostMap;
    const missing = rmCodes.filter((c) => !rawCostMap.has(c));
    if (missing.length > 0) {
      // Fallback: SupplyHistory legacy path â€” only for codes missing in Raw Materials
      const supplyMap = await buildRmCostMap(missing);
      for (const [k, v] of supplyMap) {
        if (!costMap.has(k)) costMap.set(k, v);
      }
    }

    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, size: true, pnRating: true, erpItemCode: true, productCost: true, bomId: true, costRefCode: true, availableStock: true, bomType: true },
    });

    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;
    let lastError: string | null = null;
    const noCostRmCodes = new Set<string>();
    const noBomItemCodes = new Set<string>();

    // No-BOM fallback: derive the COST CODE REF from the Indent Listing RM codes
    // for lines that have no BOM and a blank cost ref. The ref is persisted even
    // when no raw-material cost exists, and the existing "bomId absent +
    // costRefCode present" path below then resolves productCost.
    let indentRefFilled = 0;
    let indentRefIds: string[] = [];
    {
      const { planQuotationIndentCostRefs } = await import(
        "@/lib/quotationIndentCostRefResolver"
      );
      const indentRows = await prisma.indentListing.findMany({
        select: {
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      });
      const indentRefPlan = planQuotationIndentCostRefs(items, indentRows);
      if (indentRefPlan.fills.length > 0) {
        await prisma.$transaction(
          indentRefPlan.fills.map((f) =>
            prisma.enquiryItem.update({
              where: { id: f.id },
              data: { costRefCode: f.costRefCode },
            }),
          ),
        );
        const fillsById = new Map(
          indentRefPlan.fills.map((f) => [f.id, f.costRefCode]),
        );
        indentRefIds = indentRefPlan.fills.map((f) => f.id);
        indentRefFilled = indentRefIds.length;
        // Feed the derived ref back into the in-memory rows so the matching
        // pass below picks it up without a second read.
        for (const it of items) {
          const derived = fillsById.get(it.id);
          if (derived !== undefined) it.costRefCode = derived;
        }
      }
      console.log(
        `[update-product-cost-indent] indentRows=${indentRows.length} filled=${indentRefPlan.filled} ambiguous=${indentRefPlan.ambiguous} unmatched=${indentRefPlan.unmatched} noMatch=${indentRefPlan.noMatch} skippedNoItem=${indentRefPlan.skippedNoItem} hasBom=${indentRefPlan.hasBom} alreadySet=${indentRefPlan.alreadySet}`,
      );
    }

    // First-class rule: bomId absent + costRefCode present -> direct GMDUpdateItem match (before sheet BOM).
    // Pre-batch GMDUpdateItem lookups for all costRefCode candidates.
    const costRefItems = items.filter((it) => !it.bomId && it.costRefCode?.trim());
    const costRefCodes = [...new Set(costRefItems.map((i) => i.costRefCode!.trim()).filter(Boolean))];
    const crCostMap = costRefCodes.length ? await buildRawMaterialsCostMap(costRefCodes) : new Map<string, number>();
    const crStockMap = costRefCodes.length ? await getRmStockMap(costRefCodes) : new Map<string, string>();
    const crRmTypeMap = costRefCodes.length ? await getRmTypeMap(costRefCodes) : new Map<string, string>();

    for (const item of items) {
      // First-class: costRefCode direct match when bomId absent (ignore numeric codes that don't match GMDUpdateItem)
      if (!item.bomId && item.costRefCode?.trim()) {
        const ref = item.costRefCode.trim();
        const needProductCost = item.productCost == null;
        const needStock = !item.availableStock || item.availableStock.trim() === "";
        const cost = crCostMap.get(ref);
        const stock = crStockMap.get(ref);
        const rmTypeVal = crRmTypeMap.get(ref);
        const hasMatch = cost !== undefined || stock !== undefined || rmTypeVal !== undefined;
        if (hasMatch) {
          if (!needProductCost && !needStock && rmTypeVal === undefined) continue;
          try {
            let didCostUpdate = false;
            if (needProductCost && cost !== undefined && cost !== null) {
              await recalculateItem(item.id, { productCost: cost });
              didCostUpdate = true;
            } else if (needProductCost && cost === undefined) {
              noCostRmCodes.add(ref);
            }
            const dataToUpdate: any = {};
            if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
            if (needStock && stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
            if (Object.keys(dataToUpdate).length > 0) {
              await prisma.enquiryItem.update({ where: { id: item.id }, data: dataToUpdate });
            }
            const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
            if (refreshed) {
              updatedItems.push(serializeItem(refreshed));
              if (didCostUpdate) updated++;
              else if (needStock && dataToUpdate.availableStock !== undefined) updated++;
              else if (dataToUpdate.rmType !== undefined) updated++;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to update product cost (costRefCode).";
            lastError = message;
            console.error(`Error updating product cost (costRefCode) for item ${item.id}:`, error);
          }
          continue;
        }
        // No GMDUpdateItem match (e.g. numeric costRefCode) -> fall through to sheet BOM path
      }
      if (!item.erpItemCode) continue;
      const needProductCost = item.productCost == null;
      const needStock = !item.availableStock || item.availableStock.trim() === "";
      const needBomType = !item.bomType;
      // If nothing needed, skip entirely
      if (!needProductCost && !needStock && !needBomType) continue;
      const bom = bomMap.get(item.erpItemCode);
      if (!bom) {
        if (needProductCost) noBomItemCodes.add(item.erpItemCode);
        continue;
      }
      // Primary sheet has candidate - handle productCost only if needed, stock/bomType respect present checks
      const cost = costMap.get(bom.rmItemCode);
      try {
        let didCostUpdate = false;
        if (needProductCost && cost !== undefined && cost !== null) {
          await recalculateItem(item.id, { productCost: cost });
          didCostUpdate = true;
        } else if (needProductCost) {
          noCostRmCodes.add(bom.rmItemCode);
        }

        const dataToUpdate: any = {
          bomId: bom.bomId,
          rmItemCode: bom.rmItemCode,
        };
        {
          const rmTypeVal = rmTypeMap.get(bom.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (needBomType) dataToUpdate.bomType = DIRECT_M2M;
        else dataToUpdate.bomType = DIRECT_M2M; // primary always ensures bomType, but guarded above for fallback only
        if (needStock) {
          const stock = stockMap.get(bom.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") {
            dataToUpdate.availableStock = stock;
          }
        } else {
          // stock already present -> do not override, remove from update
          // keep dataToUpdate without availableStock
        }

        // Only update if we have something to persist or we did cost update
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: item.id },
            data: dataToUpdate,
          });
        }

        const refreshed = await prisma.enquiryItem.findUnique({
          where: { id: item.id },
        });
        if (refreshed) {
          updatedItems.push(serializeItem(refreshed));
          if (didCostUpdate) {
            updated++;
          } else if (needStock && dataToUpdate.availableStock !== undefined) {
            // Count stock-only updates as updated for feedback
            updated++;
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to update product cost.";
        lastError = message;
        console.error(`Error updating product cost for item ${item.id}:`, error);
      }
    }

    // A line whose cost ref was just derived from the Indent Listing but whose
    // raw material had no cost still needs to reach the client so the Cost Ref
    // Code cell repaints.
    if (indentRefIds.length > 0) {
      const returned = new Set(updatedItems.map((i) => i.id));
      const missing = indentRefIds.filter((id) => !returned.has(id));
      if (missing.length > 0) {
        const rows = await prisma.enquiryItem.findMany({ where: { id: { in: missing } } });
        for (const row of rows) updatedItems.push(serializeItem(row));
      }
    }

    if (updated === 0 && indentRefFilled === 0) {
      const errMsgs: string[] = [];
      if (noCostRmCodes.size > 0) {
        errMsgs.push(`No cost found in Raw Materials or Supply History for RM Code(s): ${[...noCostRmCodes].join(", ")}.`);
      }
      if (noBomItemCodes.size > 0) {
        errMsgs.push(`No DIRECT M2M BOM recipe found for Item Code(s): ${[...noBomItemCodes].join(", ")}.`);
      }
      return { success: false, error: errMsgs.join(" ") || lastError || "No product costs updated." };
    }
    return { success: true, data: { items: updatedItems, updated, indentRefFilled } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update product cost.";
    return { success: false, error: message };
  }
}

// Fill null or "-" cost column from Raw Materials table (2:1 BOM), triggered via UI button or API
export async function update2to1CostAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    // Guard frozen enquiries: cost is a frozen column after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update 2:1 costs: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const res = await update2to1CostForItems(itemIds);
    if (res.updatedCount === 0) {
      const errMsgs: string[] = [];
      if (res.noCostItemCodes.length > 0) {
        errMsgs.push(`No cost found in Raw Materials table for consumption item(s) of: ${res.noCostItemCodes.join(", ")}.`);
      }
      if (res.noBomItemCodes.length > 0) {
        errMsgs.push(`No 2:1 BOM recipe found for Item Code(s): ${res.noBomItemCodes.join(", ")}.`);
      }
      return { success: false, error: errMsgs.join(" ") || "No costs updated for 2:1 items." };
    }
    return { success: true, data: { items: res.updatedItems, updated: res.updatedCount } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update 2:1 cost.";
    return { success: false, error: message };
  }
}

// Unified action to update both DIRECT M2M product costs and 2:1 BOM costs for target items
export async function updateAllBomCostsAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const updatedItemsMap = new Map<string, ReturnType<typeof serializeItem>>();
    let totalUpdated = 0;
    let indentRefFilled = 0;
    const errorMessages: string[] = [];

    // 1. Process DIRECT M2M product costs
    const m2mRes = await updateProductCostFromBomAction(itemIds);
    if (m2mRes.success && m2mRes.data) {
      for (const item of m2mRes.data.items) {
        updatedItemsMap.set(item.id, item);
      }
      totalUpdated += m2mRes.data.updated;
      indentRefFilled += m2mRes.data.indentRefFilled ?? 0;
    } else if (m2mRes.error) {
      errorMessages.push(m2mRes.error);
    }

    // 2. Process 2:1 BOM costs
    const twoToOneRes = await update2to1CostAction(itemIds);
    if (twoToOneRes.success && twoToOneRes.data) {
      for (const item of twoToOneRes.data.items) {
        updatedItemsMap.set(item.id, item);
      }
      totalUpdated += twoToOneRes.data.updated;
    } else if (twoToOneRes.error && totalUpdated === 0) {
      errorMessages.push(twoToOneRes.error);
    }

    // 3. Sync available stock for any DIRECT M2M items in target
    try {
      await syncDirectM2MAvailableStock(itemIds);
      // Refresh items that might have had stock updated
      const refreshedItems = await prisma.enquiryItem.findMany({
        where: { id: { in: itemIds } },
      });
      for (const ref of refreshedItems) {
        if (updatedItemsMap.has(ref.id)) {
          updatedItemsMap.set(ref.id, serializeItem(ref));
        }
      }
    } catch (e) {
      console.warn("[updateAllBomCostsAction] syncDirectM2MAvailableStock failed:", e);
    }

    if (totalUpdated === 0 && indentRefFilled === 0) {
      return { success: false, error: errorMessages.join(" ") || "No BOM costs updated." };
    }

    return {
      success: true,
      data: {
        items: Array.from(updatedItemsMap.values()),
        updated: totalUpdated,
        indentRefFilled,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update BOM costs.";
    return { success: false, error: message };
  }
}

// Action to sync available stock for all or specified DIRECT M2M enquiry items
// Global backfill: call with no itemIds to sync all DIRECT M2M items from raw materials (GMDUpdateItem)
export async function syncDirectM2MAvailableStockAction(itemIds?: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const res = await syncDirectM2MAvailableStock(itemIds);
    let items: ReturnType<typeof serializeItem>[] = [];
    if (res.updatedIds.length > 0) {
      const updated = await prisma.enquiryItem.findMany({
        where: { id: { in: res.updatedIds } },
      });
      items = updated.map(serializeItem);
    }
    return { success: true, count: res.updatedCount, items } as const;
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to sync available stock." };
  }
}

export async function importExcelDataAction(rows: any[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    let matchedCount = 0;
    let updatedCount = 0;
    const updatedItems: any[] = [];

    for (const row of rows) {
      const { docketNumber, itemName, cost, quotedRate } = row;
      if (!docketNumber || !itemName) continue;

      // Find the parent Enquiry
      const enquiry = await prisma.enquiry.findUnique({
        where: { docketNumber: String(docketNumber).trim() },
        include: { items: true },
      });

      if (!enquiry) continue;

      // Find the corresponding EnquiryItem (match case-insensitively)
      const item = enquiry.items.find(
        (it) => it.itemName.trim().toLowerCase() === String(itemName).trim().toLowerCase()
      );

      if (!item) continue;

      matchedCount++;

      const updates: any = {};
      if (cost !== undefined && cost !== null && cost !== "") {
        updates.productCost = parseFloat(String(cost));
      }
      if (quotedRate !== undefined && quotedRate !== null && quotedRate !== "") {
        updates.quotedRate = parseFloat(String(quotedRate));
      }

      await recalculateItem(item.id, updates);
      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
      }
      updatedCount++;
    }

    return { success: true, matchedCount, updatedCount, data: { items: updatedItems } };
  } catch (error: any) {
    console.error("Error importing excel data:", error);
    return { success: false, error: error.message || "Failed to import excel data." };
  }
}

const AUTOFILL_SIZE_BLANK = ["Not detectable", "Not mentioned/cant detect size"]

/**
 * Auto-Fill step 1: work out what Auto-Fill would change and return it without saving,
 * so the user can Accept / Reject each row.
 */
export async function previewAutoFillAction(itemIds: string[]) {
  await requireAccess();
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, moc: true, size: true, pnRating: true, operationType: true, extension: true, bypass: true },
    })

    const changes: AutoFillChange[] = []
    for (const item of items) {
      const hasBlank =
        !item.itemType ||
        !item.moc ||
        !item.size ||
        AUTOFILL_SIZE_BLANK.includes(item.size) ||
        !item.operationType ||
        !item.extension ||
        item.extension === "-" ||
        !item.bypass ||
        item.bypass === "-"
      // Keyword-only correction runs even when nothing is blank, so skip the
      // AI-backed resolveItemCategory for pure-correction rows to save tokens.
      const resolved = hasBlank ? await resolveItemCategory({ itemName: item.itemName }) : null
      const add = (field: AutoFillChange["field"], newValue: string | null | undefined, extra: Partial<AutoFillChange> = {}) => {
        const oldValue = item[field] ?? ""
        if (newValue && newValue !== oldValue) {
          changes.push({ itemId: item.id, itemName: item.itemName, field, oldValue, newValue, ...extra })
        }
      }

      if (!item.itemType) {
        add("itemType", resolved?.itemType, { source: resolved?.itemTypeSource })
      } else {
        // Fix a known-wrong item type, e.g. "Dual Plate Check Valve" stored as
        // CHECK VALVE should become DPCV.
        add("itemType", correctItemType(item.itemName, item.itemType), { source: "keyword" })
      }
      if (resolved) {
        if (!item.moc) add("moc", resolved.moc, { source: resolved.mocSource })
        if (!item.size || AUTOFILL_SIZE_BLANK.includes(item.size)) {
          add("size", resolved.size !== "Not detectable" ? resolved.size : null)
        }
        // PN comes from the name ("PN 1.6", "16 kg/cm²"), so ask the user to verify it.
        add("pnRating", resolved.pnRating ?? pnFromName(item.itemName), { verify: true })
        if (!item.operationType) add("operationType", resolved.operationType)
        if (!item.extension || item.extension === "-") add("extension", resolved.extension)
        if (!item.bypass || item.bypass === "-") add("bypass", resolved.bypass !== "-" ? resolved.bypass : null)
      }
    }
    return { success: true, data: { changes } }
  } catch (error: any) {
    console.error("Error previewing auto-fill:", error)
    return { success: false, error: error.message || "Failed to preview auto-fill." }
  }
}

/** Auto-Fill step 2: save only the changes the user accepted. */
export async function applyAutoFillAction(changes: AutoFillChange[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass"]
    const byItem = new Map<string, AutoFillChange[]>()
    for (const c of changes) {
      if (!FIELDS.includes(c.field)) continue // the payload comes from the client
      byItem.set(c.itemId, [...(byItem.get(c.itemId) ?? []), c])
    }

    let updated = 0
    for (const [itemId, list] of byItem) {
      const data: Record<string, string | null> = {}
      for (const c of list) {
        data[c.field] = c.newValue
        if (c.field === "itemType") data.itemTypeSource = c.source ?? "keyword"
        if (c.field === "moc") data.mocSource = c.source ?? "keyword"
      }
      const row = await prisma.enquiryItem.update({
        where: { id: itemId },
        data,
        select: { itemType: true, moc: true, size: true, pnRating: true, operationType: true, erpItemCode: true, vaPercent: true },
      })
      updated++

      // The item code is derived from these five fields: re-resolve it so it never
      // keeps the code of the old size/type. A changed code invalidates the BOM pick.
      if (list.some((c) => DETAILS_FIELDS.includes(c.field as DetailsField))) {
        const recomputed = await recomputeItemCodeForValues(itemId, row, row.erpItemCode)
        if (recomputed.changed) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data: { bomId: null, rmItemCode: null } })
          await syncAvailableBomIds(itemId, recomputed.newCode)
        }
      }

      if (!row.vaPercent && row.itemType) {
        const defaultVa = getDefaultVaPercent(row.itemType, row.size)
        if (defaultVa !== null) await recalculateItem(itemId, { vaPercent: defaultVa })
      }
    }

    const refreshedItems = await prisma.enquiryItem.findMany({ where: { id: { in: [...byItem.keys()] } } })
    return { success: true, updated, data: { items: refreshedItems.map(serializeItem) } }
  } catch (error: any) {
    console.error("Error applying auto-fill:", error)
    return { success: false, error: error.message || "Failed to apply auto-fill." }
  }
}

// Fill blank VA% values from the default VA% table (type + size based) using keyword item-type detection only
export async function updateVaPercentAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    // Guard frozen enquiries: vaPercent/quotedRate are frozen after one-time PDF
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const checkItems = await prisma.enquiryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, enquiryId: true } });
      if (checkItems.length > 0) {
        const eIds = [...new Set(checkItems.map((i) => i.enquiryId))];
        const parents = await prisma.enquiry.findMany({ where: { id: { in: eIds } }, select: { id: true, apm: true, offerPdfGeneratedAt: true } });
        const frozenIds = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
        if (frozenIds.size > 0) {
          const frozenCount = checkItems.filter((i) => frozenIds.has(i.enquiryId)).length;
          if (frozenCount > 0) return { success: false, error: `Cannot update VA%: ${frozenCount} item(s) are frozen after one-time PDF generation â€” revert APM to edit.` };
        }
      }
    }
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, size: true, vaPercent: true },
    });

    console.log(`\n=== [Server] AUTO-FILL VA% START ===`)
    console.log(`[Server] Total items to process: ${items.length}`)

    let updated = 0;
    for (const item of items) {
      if (item.vaPercent) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: VA% already set to ${item.vaPercent}`)
        continue;
      }
      const type = item.itemType || autoDetectItemType(item.itemName);
      if (!type) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: no itemType and auto-detect failed`)
        continue;
      }
      const defaultVa = getDefaultVaPercent(type, item.size);
      if (defaultVa === null) {
        console.log(`  - SKIP ${item.itemName.substring(0, 50)}: no default VA% for type "${type}" / size "${item.size || "any"}"`)
        continue;
      }
      console.log(`  âœ“ ${item.itemName.substring(0, 50)}: VA% "" â†’ "${defaultVa}" (from ${type} / ${item.size || "any"})`)
      await recalculateItem(item.id, { vaPercent: defaultVa });
      updated++;
    }

    console.log(`\n=== [Server] AUTO-FILL VA% DONE ===`)
    console.log(`[Server] Updated: ${updated} of ${items.length} items\n`)

    const refreshedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
    });

    return { success: true, updated, data: { items: refreshedItems.map(serializeItem) } };
  } catch (error: any) {
    console.error("Error updating VA%:", error);
    return { success: false, error: error.message || "Failed to update VA%." };
  }
}
