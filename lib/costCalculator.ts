import { prisma } from "@/lib/prisma";
import { matchItemType, matchMoc } from "./itemTypePatterns";
import { roundToNearest10 } from "./rounding";

export function serializeItem(item: any) {
  return {
    ...item,
    quantity: item.quantity ? Number(item.quantity) : 0,
    productCost: item.productCost ? Number(item.productCost) : null,
    cost: item.cost ? Number(item.cost) : null,
    discount: item.discount ? Number(item.discount) : null,
    vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
    quotedRate: item.quotedRate || null,
    quotedRateGst: item.quotedRateGst || null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serializeEnquiry(enquiry: any) {
  return {
    ...enquiry,
    enquiryDate: enquiry.enquiryDate.toISOString(),
    createdAt: enquiry.createdAt.toISOString(),
    updatedAt: enquiry.updatedAt.toISOString(),
    items: enquiry.items ? enquiry.items.map(serializeItem) : [],
  };
}

export function getItemNameMerge(item: any) {
  const orderedFields = [
    item.itemType,
    item.moc,
    item.size,
    item.pnRating,
    item.operationType,
    item.extension,
    item.bypass
  ];
  return orderedFields
    .map(val => (val || "").trim())
    .filter(Boolean)
    .join("-");
}

export async function recalculateItem(
  itemId: string,
  updates?: {
    productCost?: number | null;
    extension?: string | null;
    bypass?: string | null;
    quantity?: number | null;
    vaPercent?: number | null;
    quotedRate?: number | null;
  }
) {
  // Fetch item and its parent enquiry
  const item = await prisma.enquiryItem.findUnique({
    where: { id: itemId },
    include: { enquiry: true },
  });
  if (!item) return null;

  // 1. Merge updates
  const productCost = updates && updates.productCost !== undefined
    ? updates.productCost
    : (item.productCost ? parseFloat(item.productCost.toString()) : null);
  const extension = updates && updates.extension !== undefined ? updates.extension : item.extension;
  const bypass = updates && updates.bypass !== undefined ? updates.bypass : item.bypass;
  const quantity = updates && updates.quantity !== undefined && updates.quantity !== null
    ? updates.quantity
    : (item.quantity ? parseFloat(item.quantity.toString()) : 0);
  let vaPercent = updates && updates.vaPercent !== undefined
    ? updates.vaPercent
    : (item.vaPercent ? parseFloat(item.vaPercent) : null);
  let quotedRate = updates && updates.quotedRate !== undefined
    ? (updates.quotedRate !== null ? roundToNearest10(updates.quotedRate) : null)
    : (item.quotedRate ? parseFloat(item.quotedRate) : null);

  // 2. Calculate Cost
  let cost: number | null = null;
  if (productCost !== null && productCost > 0) {
    // 2.1. Extension Cost (Flat)
    let extCost = 0;
    if (extension && extension !== "-") {
      const extMapping = await prisma.extensionCost.findUnique({ where: { length: extension } });
      if (extMapping) extCost = parseFloat(extMapping.cost) || 0;
    }

    // 2.2. Bypass Cost (Flat)
    let bpCost = 0;
    if (bypass && bypass !== "-") {
      const bpMapping = await prisma.bypassCost.findUnique({ where: { size: bypass } });
      if (bpMapping) bpCost = parseFloat(bpMapping.cost) || 0;
    }

    // 2.3. Payment Terms Cost (%)
    let ptPct = 0;
    if (item.enquiry.paymentTerms && item.enquiry.paymentTerms !== "-") {
      const ptMapping = await prisma.paymentTermsCost.findUnique({ where: { terms: item.enquiry.paymentTerms } });
      if (ptMapping) ptPct = parseFloat(ptMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.4. Inspection Cost (%)
    let inspPct = 0;
    if (item.enquiry.inspection && item.enquiry.inspection !== "-") {
      const inspMapping = await prisma.inspectionCost.findUnique({ where: { type: item.enquiry.inspection } });
      if (inspMapping) inspPct = parseFloat(inspMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.5. PBG Cost (%)
    let pbgPct = 0;
    if (item.enquiry.pbg && item.enquiry.pbg !== "-") {
      const pbgMapping = await prisma.pbgCost.findUnique({ where: { pbg: item.enquiry.pbg } });
      if (pbgMapping) pbgPct = parseFloat(pbgMapping.costPct.replace(/%/g, "")) / 100 || 0;
    }

    // 2.6. Transportation Cost (%)
    let transPct = 0;
    if (item.enquiry.state && item.enquiry.state !== "-") {
      const transMapping = await prisma.transportationCost.findUnique({ where: { state: item.enquiry.state } });
      if (transMapping) {
        // Rule: If Product Cost >= 50 Lakhs (5000000), use fullLoad. Else use partLoad
        const isFullLoad = productCost >= 5000000;
        const pctStr = (isFullLoad ? transMapping.fullLoad : transMapping.partLoad).replace(/%/g, "").trim();
        transPct = parseFloat(pctStr) / 100 || 0;
      }
    }

    const pctMultiplier = ptPct + inspPct + pbgPct + transPct;
    const baseProductCost = productCost * 1.08;
    cost = baseProductCost + extCost + bpCost + baseProductCost * pctMultiplier;
    cost = parseFloat(cost.toFixed(2));
  }

  // 3. Handle Cost-related side-effects
  if (cost !== null && cost > 0) {
    if (updates && updates.quotedRate !== undefined && updates.quotedRate !== null) {
      // If quotedRate was directly updated, recalculate vaPercent based on new cost
      vaPercent = parseFloat((((quotedRate! / cost) - 1) * 100).toFixed(2));
    } else if (vaPercent !== null) {
      // Otherwise, if vaPercent exists, recalculate quotedRate based on new cost
      quotedRate = roundToNearest10(cost * (1 + vaPercent / 100));
    } else if (quotedRate !== null) {
      // If vaPercent is null/undefined but quotedRate exists, calculate vaPercent
      vaPercent = parseFloat((((quotedRate! / cost) - 1) * 100).toFixed(2));
    }
  } else {
    // If cost is null/0, quotedRate and vaPercent should probably be reset if cost was cleared
    if (productCost === null) {
      quotedRate = null;
      vaPercent = null;
    }
  }

  // 4. Calculate QR incl. GST
  let quotedRateGst: string | null = null;
  if (quotedRate !== null && quotedRate > 0) {
    quotedRateGst = (quotedRate * 1.18).toFixed(2);
  }

  // 5. Calculate Totals
  let itemWiseTotal: string | null = null;
  let totalVal: string | null = null;
  if (quantity > 0 && quotedRate !== null && quotedRate > 0) {
    const itemWise = quantity * quotedRate;
    itemWiseTotal = itemWise.toFixed(2);
    totalVal = (itemWise * 1.18).toFixed(2);
  }

  // Generate name merge
  const mergedNameVal = getItemNameMerge({
    itemType: item.itemType,
    moc: item.moc,
    size: item.size,
    pnRating: item.pnRating,
    operationType: item.operationType,
    extension,
    bypass
  });

  // 5. Update Database
  const updatedItem = await prisma.enquiryItem.update({
    where: { id: itemId },
    data: {
      productCost: productCost,
      extension: extension,
      bypass: bypass,
      quantity: quantity,
      cost: cost,
      vaPercent: vaPercent !== null ? String(vaPercent) : null,
      quotedRate: quotedRate !== null ? quotedRate.toFixed(2) : null,
      quotedRateGst: quotedRateGst,
      itemWiseTotalValue: itemWiseTotal,
      totalValue: totalVal,
      itemNameMerge: mergedNameVal === "" ? null : mergedNameVal,
    },
  });

  return serializeItem(updatedItem);
}

export async function recalculateEnquiryItems(enquiryId: string) {
  const items = await prisma.enquiryItem.findMany({
    where: { enquiryId },
  });
  const serializedItems = [];
  for (const item of items) {
    const res = await recalculateItem(item.id);
    if (res) serializedItems.push(res);
  }
  return serializedItems;
}

export function autoDetectItemType(itemName: string | null | undefined): string | null {
  return matchItemType(itemName);
}

export function autoDetectMoc(itemName: string | null | undefined): string | null {
  return matchMoc(itemName);
}
