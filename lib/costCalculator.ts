import { prisma } from "@/lib/prisma";

export function serializeItem(item: any) {
  return {
    ...item,
    quantity: item.quantity ? Number(item.quantity) : 0,
    productCost: item.productCost ? Number(item.productCost) : null,
    cost: item.cost ? Number(item.cost) : null,
    discount: item.discount ? Number(item.discount) : null,
    vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
    quotedRate: item.quotedRate || null,
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
    ? updates.quotedRate
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
      quotedRate = parseFloat((cost * (1 + vaPercent / 100)).toFixed(2));
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

  // 4. Calculate Totals
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
  if (!itemName) return null;
  const nameLower = itemName.toLowerCase();

  if (nameLower.includes("butterfly")) {
    return "BUTTERFLY VALVE";
  }
  if (nameLower.includes("sluice valve") || nameLower.includes("sluice/scoure valve") || nameLower.includes("sluice") || nameLower.includes("gate") || nameLower.includes("scoure")) {
    if (nameLower.includes("knife")) {
      return "KNIFE GATE VALVE";
    }
    if (nameLower.includes("resilient") && nameLower.includes("rising")) {
      return "SLUICE VALVE-RESILIENT-RISING";
    }
    if (nameLower.includes("resilient")) {
      return "SLUICE VALVE-RESILIENT-NON-RISING";
    }
    if (nameLower.includes("rising")) {
      return "SLUICE VALVE-METAL-RISING";
    }
    return "SLUICE VALVE-METAL-NON-RISING";
  }
  if (nameLower.includes("air valve")) {
    if (nameLower.includes("tamper proof") || nameLower.includes("tpa") || nameLower.includes("tpav")) {
      return "TPAV";
    }
    if (nameLower.includes("vacuum") || nameLower.includes("vacum")) {
      return "VACUM BREAKER VALVE";
    }
    return "AIR VALVE";
  }
  if (nameLower.includes("check valve") || nameLower.includes("non return") || nameLower.includes("non-return") || nameLower.includes("dpcv")) {
    if (nameLower.includes("dual plate") || nameLower.includes("dpcv")) {
      return "DPCV";
    }
    return "CHECK VALVE";
  }
  if (nameLower.includes("ball valve")) {
    return "BALL VALVE";
  }
  if (nameLower.includes("globe valve") || (nameLower.includes("globe") && nameLower.includes("valve"))) {
    return "GLOBE VALVE";
  }
  if (nameLower.includes("zero velocity")) {
    return "ZERO VELOCITY VALVE";
  }
  if (nameLower.includes("solenoid")) {
    return "SOLENOID VALVE";
  }
  if (nameLower.includes("foot") && nameLower.includes("valve")) {
    return "FOOT VALVE";
  }
  if (nameLower.includes("plug") && nameLower.includes("valve")) {
    return "PLUG VALVE";
  }
  if (nameLower.includes("control") && nameLower.includes("valve")) {
    return "ALTITUDE CONTROL VALVE";
  }
  if (nameLower.includes("tpav") || nameLower.includes("tamper proof")) {
    return "TPAV";
  }
  if (nameLower.includes("sluice gate") || nameLower.includes("gate")) {
    if (nameLower.includes("knife")) {
      return "KNIFE GATE VALVE";
    }
    return "SLUICE GATE";
  }
  if (nameLower.includes("bellow") || nameLower.includes("expansion")) {
    return "EXPANSION BELOWS";
  }
  if (nameLower.includes("bolts") || nameLower.includes("nuts") || nameLower.includes("screw") || nameLower.includes("bolts or nuts")) {
    return "BOLTS OR NUTS";
  }
  if (nameLower.includes("gasket")) {
    return "GASKET";
  }
  if (nameLower.includes("dismantling")) {
    return "DISMANTLING JOINT";
  }
  if (nameLower.includes("flange")) {
    return "COMPANION FLANGE";
  }

  return null;
}

export function autoDetectMoc(itemName: string | null | undefined): string | null {
  if (!itemName) return null;
  const nameLower = itemName.toLowerCase();

  // Explicit overrides
  if (nameLower.includes("ms") || nameLower.includes("m.s.") || nameLower.includes("mild steel")) {
    return "MILD STEEL";
  }
  if (nameLower.includes("cs") || nameLower.includes("c.s.") || nameLower.includes("cast steel") || nameLower.includes("carbon steel") || nameLower.includes("wcb")) {
    return "CAST STEEL/CARBON STEEL";
  }
  if (
    nameLower.includes("ss") ||
    nameLower.includes("s.s.") ||
    nameLower.includes("ss304") ||
    nameLower.includes("ss316") ||
    nameLower.includes("cf8") ||
    nameLower.includes("cf8m") ||
    nameLower.includes("stainless steel")
  ) {
    return "STAINLESS STEEL";
  }
  if (nameLower.includes("fs") || nameLower.includes("f.s.") || nameLower.includes("forged steel")) {
    return "FORGED STEEL";
  }
  if (
    nameLower.includes("gm") ||
    nameLower.includes("g.m.") ||
    nameLower.includes("gun metal") ||
    nameLower.includes("brass") ||
    nameLower.includes("copper alloy") ||
    nameLower.includes("bronze")
  ) {
    return "GUN METAL/ BRASS";
  }
  if (nameLower.includes("actuator")) {
    return "ACTUATOR";
  }
  if (nameLower.includes("rubber") || nameLower.includes("epdm") || nameLower.includes("nbr") || nameLower.includes("neoprene")) {
    return "RUBBER";
  }
  if (nameLower.includes("leather")) {
    return "LEATHER";
  }
  if (nameLower.includes("monel")) {
    return "MONEL STEEL";
  }
  if (nameLower.includes("wooden")) {
    return "WOODEN";
  }
  if (nameLower.includes("gi") || nameLower.includes("g.i.") || nameLower.includes("galvanised") || nameLower.includes("galvanized")) {
    return "GALVANISED";
  }

  // Fallbacks
  if (
    nameLower.includes("di") ||
    nameLower.includes("ci") ||
    nameLower.includes("d.i") ||
    nameLower.includes("c.i") ||
    nameLower.includes("ductile") ||
    nameLower.includes("cast iron") ||
    nameLower.includes("sg iron") ||
    nameLower.includes("valve") ||
    nameLower.includes("gate") ||
    nameLower.includes("scoure") ||
    nameLower.includes("kinetic") ||
    nameLower.includes("dpcv") ||
    nameLower.includes("tpav") ||
    nameLower.includes("bellow") ||
    nameLower.includes("flange") ||
    nameLower.includes("dismantling")
  ) {
    return "DUCTILE IRON/CAST IRON";
  }

  return null;
}
