import { prisma } from "@/lib/prisma";
import { recalculateItem } from "@/lib/costCalculator";
import { buildRmCostMap, DIRECT_M2M, getBomEntry } from "@/lib/gmdBomCostLookup";
import { buildRawMaterialsCostMap } from "@/lib/gmd2to1CostLookup";
import { getDistinctBomIds, getNoUseBomIdSet, findBomForItem } from "@/lib/verifyBomLookup";
import { getRmStockMap, getRmTypeMap } from "@/lib/directM2MStockLookup";

// Helper: populate availableBomIds from VerifyBom for a given erpItemCode
// Quotation-scoped: excludes NO-USE bomIds (VerifyBom.noUse == "NO USE") so they don't reappear in the dashboard dropdown
// Per-code consistency: updates ALL rows sharing the same erpItemCode (so same itemCode always has same array)
export async function syncAvailableBomIds(itemId: string, erpItemCode: string | null) {
  try {
    if (!erpItemCode) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
      return [];
    }
    const ids = await getDistinctBomIds(erpItemCode);
    const noUse = await getNoUseBomIdSet(ids);
    const filtered = ids.filter((id) => !noUse.has(id));
    // Per-code updateMany ensures every EnquiryItem with the same erpItemCode gets the identical array
    // (prevents blank vs dropdown divergence for e.g. FSD040074). Never brings back NO-USE.
    await prisma.enquiryItem.updateMany({ where: { erpItemCode }, data: { availableBomIds: filtered } });
    return filtered;
  } catch (e) {
    console.warn(`[syncAvailableBomIds] failed for ${itemId} code=${erpItemCode}:`, e);
    return [];
  }
}

// Helper: if itemCode changes and productCost is null, auto-fill productCost from BOM
// Now respects availableBomIds: if VerifyBom has multiple BOMs, defer until user selects one
// Fallback: when bomId IS NULL, erpItemCode IS NOT NULL, and primary has zero candidates,
//           costRefCode is treated as ephemeral bomId to derive productCost/availableStock/bomType (bomId stays NULL)
// Non-override: if productCost/availableStock already present, do not override (fill only missing)
export async function maybeUpdateProductCostFromNewCode(itemId: string, newCode: string | null, currentProductCost: any) {
  if (!newCode) return;
  // Do not early-return on productCost alone - we still need to fill availableStock/bomType via fallback if missing
  // Fetch meta for fallback gates (includes present-value checks)
  const preMeta = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { bomId: true, costRefCode: true, productCost: true, availableStock: true, bomType: true } });
  const needProductCost = preMeta?.productCost == null;
  const needStock = !preMeta?.availableStock || preMeta.availableStock.trim() === "";
  const needBomType = !preMeta?.bomType;
  // "0" is present per requirement (trim() === "0" is non-empty)
  if (!needProductCost && !needStock && !needBomType) return;
  try {
    // First-class rule: bomId absent + costRefCode present -> direct GMDUpdateItem match
    if (!preMeta?.bomId && preMeta?.costRefCode?.trim()) {
      const refCode = preMeta.costRefCode.trim();
      // Batch lookups for this single code (reuses existing helpers which filter empty values)
      const rawMap = await buildRawMaterialsCostMap([refCode]);
      const cost = rawMap.get(refCode);
      let fbStock: string | undefined;
      let fbRmType: string | undefined;
      {
        const stockMap = await getRmStockMap([refCode]);
        const v = stockMap.get(refCode);
        if (v !== undefined && v.trim() !== "") fbStock = v;
      }
      {
        const rmTypeMap = await getRmTypeMap([refCode]);
        const v = rmTypeMap.get(refCode);
        if (v !== undefined) fbRmType = v;
      }
      // If costRefCode matches a GMDUpdateItem row, fill cost/stock/rmType and return (ignore numbers that don't match)
      const hasMatch = cost !== undefined || fbStock !== undefined || fbRmType !== undefined;
      if (hasMatch) {
        if (needProductCost && cost !== undefined && cost !== null) {
          await recalculateItem(itemId, { productCost: cost });
        }
        const data: any = {};
        if (fbRmType !== undefined) data.rmType = fbRmType;
        if (needStock && fbStock !== undefined) data.availableStock = fbStock;
        if (Object.keys(data).length > 0) {
          await prisma.enquiryItem.update({ where: { id: itemId }, data });
        }
        return;
      }
      // No GMDUpdateItem match (e.g. numeric costRefCode) -> fall through to normal BOM logic
    }
    // Always populate availableBomIds from VerifyBom first
    const candidateIds = await syncAvailableBomIds(itemId, newCode);
    // If multiple candidates, defer bom/productCost until user selects via selectBomIdAction
    if (candidateIds.length > 1) {
      return;
    }
    if (candidateIds.length === 1) {
      // Single candidate path: try VerifyBom row for cost, fallback to sheet BOM
      // PRIORITY: Raw Materials (GMDUpdateItem.cost) wins; SupplyHistory is fallback
      // Non-override: only set productCost if needProductCost, but bomId/bomType/rmItemCode/availableStock still respect present checks
      const vbRow = await findBomForItem(newCode, candidateIds[0]);
      if (vbRow?.rmItemCode) {
        // Try Raw Materials first, then SupplyHistory fallback
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([vbRow.rmItemCode]);
          cost = rawMap.get(vbRow.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([vbRow.rmItemCode]);
            cost = supplyMap.get(vbRow.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        // Primary path sets bomId/bomType/rmItemCode; stock guarded by needStock (don't override present stock)
        const bomType = vbRow.bomIdType || DIRECT_M2M;
        const dataToUpdate: any = { bomId: vbRow.bomId, rmItemCode: vbRow.rmItemCode, bomType };
        {
          const rmTypeMap = await getRmTypeMap([vbRow.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(vbRow.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (bomType === DIRECT_M2M && needStock) {
          const stockMap = await getRmStockMap([vbRow.rmItemCode]);
          const stock = stockMap.get(vbRow.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
        }
        // Only update if something to set or productCost was set
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: itemId },
            data: dataToUpdate,
          });
        }
        return;
      }
    }
    // Zero or single but VerifyBom miss â†’ fallback to sheet DIRECT_M2M BOM
    // PRIORITY: Raw Materials wins; SupplyHistory fallback
    // Non-override: only fill missing productCost/availableStock/bomType
    {
      const bom = await getBomEntry(newCode);
      if (bom) {
        let cost: number | undefined;
        if (needProductCost) {
          const rawMap = await buildRawMaterialsCostMap([bom.rmItemCode]);
          cost = rawMap.get(bom.rmItemCode);
          if (cost === undefined) {
            const supplyMap = await buildRmCostMap([bom.rmItemCode]);
            cost = supplyMap.get(bom.rmItemCode);
          }
          if (cost !== undefined && cost !== null) {
            await recalculateItem(itemId, { productCost: cost });
          }
        }
        const dataToUpdate: any = { bomId: bom.bomId, rmItemCode: bom.rmItemCode, bomType: DIRECT_M2M };
        {
          const rmTypeMap = await getRmTypeMap([bom.rmItemCode]);
          const rmTypeVal = rmTypeMap.get(bom.rmItemCode);
          if (rmTypeVal !== undefined) dataToUpdate.rmType = rmTypeVal;
        }
        if (needStock) {
          const stockMap = await getRmStockMap([bom.rmItemCode]);
          const stock = stockMap.get(bom.rmItemCode);
          if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
          else delete dataToUpdate.availableStock;
        }
        // For primary sheet, bomId/bomType/rmItemCode are required to persist even if needBomType false (primary sets bomType)
        // but availableStock is guarded by needStock
        if (!needStock) delete dataToUpdate.availableStock;
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.enquiryItem.update({
            where: { id: itemId },
            data: dataToUpdate,
          });
        }
        return;
      }
    }
    // Zero fallback also requires checking candidateIds==0 - if we have 1 candidate we already returned; if bom exists we returned
    if (candidateIds.length !== 0) return;
    // Fallback: bomId absent -> direct GMDUpdateItem match on costRefCode (code cost ref is an erpItemCode)
    // Keeps bomId null / rmItemCode null / availableBomIds [] ; bomType stays null per requirement
    const fallbackMeta = preMeta; // reuse pre-fetched meta (already has bomId,costRefCode,productCost,availableStock,bomType)
    if (fallbackMeta?.bomId) return; // bomId already present, do not fallback
    const fallbackCode = fallbackMeta?.costRefCode?.trim();
    if (!fallbackCode) return;
    let fallbackCost: number | undefined;
    let fbStock: string | undefined;
    let fbRmType: string | undefined;
    {
      const rawMap = await buildRawMaterialsCostMap([fallbackCode]);
      fallbackCost = rawMap.get(fallbackCode);
      // availableStock / rmType from the same GMDUpdateItem row
      const stockMap = await getRmStockMap([fallbackCode]);
      const stockVal = stockMap.get(fallbackCode);
      if (stockVal !== undefined && stockVal.trim() !== "") fbStock = stockVal;
      const rmTypeMap = await getRmTypeMap([fallbackCode]);
      const rt = rmTypeMap.get(fallbackCode);
      if (rt !== undefined) fbRmType = rt;
    }
    if (needProductCost && fallbackCost !== undefined && fallbackCost !== null) {
      await recalculateItem(itemId, { productCost: fallbackCost });
    }
    const fallbackData: any = {}; // keep bomId null, rmItemCode null, availableBomIds [] ; bomType stays null per requirement
    if (fbRmType !== undefined) fallbackData.rmType = fbRmType;
    if (needStock && fbStock !== undefined) fallbackData.availableStock = fbStock;
    if (Object.keys(fallbackData).length > 0) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: fallbackData });
    }
  } catch (e) {
    console.warn(`[maybeUpdateProductCost] failed for ${itemId} code=${newCode}:`, e);
  }
}
