"use server";
import { requireAccess, loginRequired } from "@/lib/access";
import { ERP_CLOSED_STATUSES, C_BATCH_VALUE } from "@/lib/erpItemStatus";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";
import { serializeItem, serializeEnquiry } from "@/lib/costCalculator";
import { makeImageKey } from "@/lib/imageKey";
import { buildDensityMap, computeBoltVolumeMm3, computeBoltWeightKg, computeNutBoltCost, computeNutWeightKg, encodeBoltWeight, parseNumber, resolveBoltMaterial, resolveBoltRateKey, resolveMocDensity } from "@/lib/technical/formulas";

export async function updateSupplyHistoryFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  await requireAccess();
  const updated = await prisma.supplyHistoryItem.update(
    {
      where: { id },
      data: { [field]: value },
    }
  );
  return { id, field, value };
}

/**
 * Remembers the BOM a Supply History row should display. `bomId` comes from the
 * row's BOM dropdown, which lists every BOM the row's raw material feeds into.
 * The chosen BOM resolves to a specific `BomItem` so its component cost can be
 * shown. Passing `null` clears the selection.
 */
export async function updateSupplyHistorySelectedBomAction(
  supplyHistoryItemId: string,
  bomId: string | null,
) {
  "use server";
  await requireAccess();
  try {
    if (!bomId) {
      await prisma.supplyHistoryItem.update({
        where: { id: supplyHistoryItemId },
        data: { selectedBomItemId: null },
      });
      return { success: true, data: { bomId: null } };
    }

    // Only a BOM that is actually linked to this Supply History row is valid.
    const link = await prisma.supplyHistoryBomLink.findFirst({
      where: { supplyHistoryItemId, bom: { is: { bomId } } },
      select: { bomItemId: true },
      orderBy: { bomItemId: "asc" },
    });
    if (!link) {
      return {
        success: false,
        error: "Selected BOM is not linked to this Supply History row.",
      } as const;
    }

    await prisma.supplyHistoryItem.update({
      where: { id: supplyHistoryItemId },
      data: { selectedBomItemId: link.bomItemId },
    });
    return { success: true, data: { bomId } };
  } catch (e: unknown) {
    console.error("[updateSupplyHistorySelectedBomAction] failed:", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to save BOM selection.",
    } as const;
  }
}

/**
 * Manually edits the cost of the BOM currently selected on a Supply History row.
 * The cost lives on the selected `BomItem` (shared with the BOM dashboard), not
 * on `SupplyHistoryItem`, so this writes through to `BomItem.cost`.
 */
export async function updateSupplyHistoryBomCostAction(
  supplyHistoryItemId: string,
  value: string | number | null,
) {
  "use server";
  await requireAccess();
  try {
    const item = await prisma.supplyHistoryItem.findUnique({
      where: { id: supplyHistoryItemId },
      select: { selectedBomItemId: true },
    });
    if (!item) {
      return { success: false, error: "Supply History row not found." } as const;
    }
    if (!item.selectedBomItemId) {
      return {
        success: false,
        error: "No BOM is selected for this row.",
      } as const;
    }

    // Only a BomItem actually linked to this row may be edited.
    const link = await prisma.supplyHistoryBomLink.findFirst({
      where: { supplyHistoryItemId, bomItemId: item.selectedBomItemId },
      select: { bomItemId: true },
    });
    if (!link) {
      return {
        success: false,
        error: "Selected BOM is not linked to this Supply History row.",
      } as const;
    }

    let cost: number | null = null;
    if (value !== null && String(value).trim() !== "") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return { success: false, error: "BOM cost must be a number." } as const;
      }
      cost = parsed;
    }

    await prisma.bomItem.update({
      where: { id: item.selectedBomItemId },
      data: { cost },
    });
    return { success: true, data: { cost } };
  } catch (e: unknown) {
    console.error("[updateSupplyHistoryBomCostAction] failed:", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to update BOM cost.",
    } as const;
  }
}

export async function updateBisStatusFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  await requireAccess();
  const allowed = ["remark", "licenseNo", "itemName", "bisNo", "expiryDate", "applicationStatus", "reachedLab"];
  if (!allowed.includes(field)) {
    return { success: false, error: `Field ${field} is not editable.` } as any;
  }
  try {
    let parsedVal: any = value;
    if (field === "expiryDate" && value) {
      const d = new Date(value);
      parsedVal = isNaN(d.getTime()) ? null : d;
    }
    const updated = await prisma.bisStatus.update({
      where: { id },
      data: { [field]: parsedVal },
    });
    return { success: true, data: updated } as any;
  } catch (error: any) {
    return { success: false, error: error.message || `Failed to update ${field}.` } as any;
  }
}

export async function addBisStatusUpdateAction(input: {
  bisStatusId: string;
  status?: string | null;
  nextStep?: string | null;
  nextDate?: string | null;
  remark?: string | null;
  updatedBy?: string | null;
}) {
  "use server";
  await requireAccess();
  const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
  const status = clean(input.status);
  const remark = clean(input.remark);
  if (!status && !remark) {
    return { success: false, error: "Enter a status or a remark." } as any;
  }
  let nextDate: Date | null = null;
  if (clean(input.nextDate)) {
    nextDate = new Date(input.nextDate as string);
    if (isNaN(nextDate.getTime())) {
      return { success: false, error: "Next follow-up date is not a valid date." } as any;
    }
  }
  try {
    const { auth } = await import("@/auth");
    const user = (await auth())?.user as { name?: string | null } | undefined;
    const updatedBy = user?.name ?? clean(input.updatedBy);
    const [update] = await prisma.$transaction([
      prisma.bisStatusUpdate.create({
        data: { bisStatusId: input.bisStatusId, status, nextStep: clean(input.nextStep), nextDate, remark, updatedBy },
      }),
      prisma.bisStatus.update({
        where: { id: input.bisStatusId },
        data: { ...(status && { applicationStatus: status }), ...(remark && { remark }) },
      }),
    ]);
    return { success: true, data: update } as any;
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to add update." } as any;
  }
}

export async function getBisStatusHistoryAction(bisStatusId: string) {
  "use server";
  await requireAccess();
  try {
    const data = await prisma.bisStatusUpdate.findMany({
      where: { bisStatusId },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data } as any;
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to load history." } as any;
  }
}

/** BisStatus ids with no update in the last 3 calendar days (or never updated). */
export async function getBisStaleIdsAction() {
  "use server";
  await requireAccess();
  try {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 3);
    const fresh = await prisma.bisStatusUpdate.findMany({
      where: { createdAt: { gte: cutoff } },
      select: { bisStatusId: true },
      distinct: ["bisStatusId"],
    });
    const freshIds = fresh.map((f) => f.bisStatusId);
    const stale = await prisma.bisStatus.findMany({
      where: { id: { notIn: freshIds } },
      select: { id: true },
    });
    return { success: true, data: stale.map((s) => s.id) } as any;
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to load stale rows." } as any;
  }
}

export async function getGMDCastingRatesAction() {
  "use server";
  await requireAccess();
  try {
    const rows = await prisma.lookupOption.findMany({
      where: { type: "GMD_CASTING_RATE" },
    });
    const rates: Record<string, string> = {
      DI: "",
      CS: "",
      CI: "",
      SS: "",
      Bronze: "",
      MS: "",
      GI: "",
    };
    for (const row of rows) {
      const eq = row.value.indexOf("=");
      if (eq === -1) continue;
      const key = row.value.slice(0, eq).trim();
      if (key in rates) rates[key] = row.value.slice(eq + 1).trim();
    }
    return { success: true, data: rates };
  } catch (error: any) {
    console.error("Error fetching casting rates:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch casting rates.",
    };
  }
}

export async function saveGMDCastingRateAction(key: string, value: string) {
  "use server";
  await requireAccess();
  try {
    const type = "GMD_CASTING_RATE";
    const rowValue = `${key}=${value}`;
    const existing = await prisma.lookupOption.findFirst({
      where: { type, value: { startsWith: `${key}=` } },
    });
    if (existing) {
      await prisma.lookupOption.update({
        where: { id: existing.id },
        data: { value: rowValue },
      });
    } else {
      await prisma.lookupOption.create({ data: { type, value: rowValue } });
    }
    return { success: true };
  } catch (error: any) {
    console.error("Error saving casting rate:", error);
    return {
      success: false,
      error: error.message || "Failed to save casting rate.",
    };
  }
}

/**
 * Set the bolt material (SS/GI) for a Flange row and recompute its bolt/nut
 * weight and cost. MS/CS rows ignore the passed material and stay locked to the
 * flange MOC; every other MOC defaults to GI when no material is passed. The
 * BOLT WEIGHT cell encodes the result as `<weight>|<material>`; costs use the
 * material's per-kg `GMD_CASTING_RATE` rate.
 */
export async function updateFlangeBoltWeightAction(id: string, material: string) {
  "use server";
  await requireAccess();
  try {
    const flange = await prisma.flange.findUnique({ where: { id } });
    if (!flange) {
      return { success: false, error: "Flange row not found." };
    }

    const [densityRows, rateRows] = await Promise.all([
      prisma.density.findMany({
        select: { material: true, densityGmCm3: true },
      }),
      prisma.lookupOption.findMany({
        where: { type: "GMD_CASTING_RATE" },
        select: { value: true },
      }),
    ]);
    const densityByMaterial = buildDensityMap(densityRows);

    const base = resolveBoltMaterial(flange.moc);
    const chosen =
      base === "MS" || base === "CS"
        ? base
        : material === "GI" || material === "SS"
          ? material
          : "GI";

    const volume = computeBoltVolumeMm3(
      parseNumber(flange.boltDiaMm),
      parseNumber(flange.boltLengthMm),
    );
    const density = resolveMocDensity(chosen, densityByMaterial);
    const weightKg = computeBoltWeightKg(volume, density);
    const nutWeightKg = computeNutWeightKg(weightKg);

    // Per-kg rate for the chosen material, from "KEY=rate" lookup rows.
    const rateKey = resolveBoltRateKey(chosen);
    let ratePerKg: number | null = null;
    if (rateKey != null) {
      const rateRow = rateRows.find((r) => {
        const eq = r.value.indexOf("=");
        return eq !== -1 && r.value.slice(0, eq).trim() === rateKey;
      });
      if (rateRow) {
        ratePerKg = parseNumber(rateRow.value.slice(rateRow.value.indexOf("=") + 1));
      }
    }
    const { boltCost, nutCost } = computeNutBoltCost(
      weightKg,
      nutWeightKg,
      ratePerKg,
    );

    const updated = await prisma.flange.update({
      where: { id },
      data: {
        boltWeight: encodeBoltWeight(weightKg, chosen),
        nutWeight: nutWeightKg != null ? nutWeightKg.toFixed(2) : "",
        boltCost: boltCost != null ? boltCost.toFixed(2) : "",
        nutCost: nutCost != null ? nutCost.toFixed(2) : "",
      },
    });

    return {
      success: true,
      data: {
        boltWeight: updated.boltWeight,
        nutWeight: updated.nutWeight,
        boltCost: updated.boltCost,
        nutCost: updated.nutCost,
      },
    };
  } catch (error) {
    console.error("Error updating flange bolt weight:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update bolt weight.",
    };
  }
}

// Match each EnquiryItem's erpItemCode against ContractReview.itemCode and
// populate contractReviewRate with the rate from the most-recent contract row.
//
// The same button also gap-fills a BLANK costRefCode from
// ContractReview.costCodeRef (the Indent Listing RM code), which is a separate
// lookup: different normalizer, different case sensitivity, different recency
// handling. A cell that already has a value is never touched.
export async function fetchContractReviewRatesAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    // 1. Fetch the items we care about
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        erpItemCode: true,
        productCost: true,
        costRefCode: true,
      },
    });

    // 2. Collect unique non-null erpItemCodes
    const codes = [...new Set(items.map((i) => i.erpItemCode).filter(Boolean))] as string[];
    if (codes.length === 0) {
      return { success: false, error: "No ERP item codes found on selected items." };
    }

    // 3. For each distinct code, find the ContractReview row with the most-recent dateOfContract.
    //    We fetch all matching rows and pick the best one in JS so we avoid complex raw SQL.
    const contractRows = await tenderPrisma.contractReview.findMany({
      where: { itemCode: { in: codes } },
      select: { itemCode: true, rate: true, dateOfContract: true, createdAt: true },
    });

    // Build a map: itemCode â†’ best rate (most recent dateOfContract, then createdAt)
    const bestRateMap = new Map<string, string>();
    for (const row of contractRows) {
      if (!row.rate) continue;
      const prev = bestRateMap.get(row.itemCode);
      if (!prev) {
        bestRateMap.set(row.itemCode, row.rate);
      } else {
        // Replace if this row is more recent
        const existing = contractRows.find(
          (r) => r.itemCode === row.itemCode && r.rate === prev
        );
        const existingDate = existing?.dateOfContract
          ? new Date(existing.dateOfContract).getTime()
          : existing?.createdAt.getTime() ?? 0;
        const rowDate = row.dateOfContract
          ? new Date(row.dateOfContract).getTime()
          : row.createdAt.getTime();
        if (rowDate > existingDate) {
          bestRateMap.set(row.itemCode, row.rate);
        }
      }
    }

    // 3b. Cost code ref source. Queried separately from the rate rows above and
    //     on purpose: the rate map keys off raw strings with a case-sensitive
    //     `in`, so adding `mode: "insensitive"` there would silently change
    //     which rows the rate lookup matches. The cost ref path normalizes both
    //     sides (trim / collapse whitespace / upper), so it needs the
    //     case-insensitive filter to agree with its own keying.
    const { planCostRefBackfill } = await import(
      "@/lib/contractReviewCostRefBackfill"
    );
    const { normalizeContractKey } = await import(
      "@/lib/gmd_lib/contract-review-enquiry-backfill"
    );

    const normalizedCodes = [
      ...new Set(
        items
          .map((i) => i.erpItemCode)
          .filter((c): c is string => !!c)
          .map(normalizeContractKey)
          .filter(Boolean),
      ),
    ];

    let costRefPlan: Awaited<
      ReturnType<typeof planCostRefBackfill>
    > | null = null;
    if (normalizedCodes.length > 0) {
      const costCodeRefRows = await tenderPrisma.contractReview.findMany({
        where: { itemCode: { in: normalizedCodes, mode: "insensitive" } },
        select: {
          itemCode: true,
          costCodeRef: true,
          dateOfContract: true,
          createdAt: true,
          syncedAt: true,
        },
      });
      costRefPlan = planCostRefBackfill(items, costCodeRefRows);
    } else {
      costRefPlan = planCostRefBackfill(items, []);
    }

    const costRefById = new Map(
      (costRefPlan?.fills ?? []).map((f) => [f.id, f.costRefCode]),
    );

    // 4. Update each matching item
    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;

    for (const item of items) {
      if (!item.erpItemCode) continue;
      const rate = bestRateMap.get(item.erpItemCode);

      // Sparse write: the rate and the cost code ref are resolved
      // independently, so an item with no matching rate row can still get a
      // cost ref filled (and vice versa).
      const data: Record<string, string | null> = {};

      if (rate !== undefined) {
        let pdVal: string | null = null;
        if (rate && item.productCost != null) {
          const cr = parseFloat(String(rate).replace(/,/g, ""));
          const pc = Number(item.productCost);
          if (!isNaN(cr) && !isNaN(pc) && pc !== 0) {
            pdVal = `${(((cr - pc) / pc) * 100).toFixed(2)}%`;
          }
        }
        data.contractReviewRate = rate;
        data.pdcostValidation = pdVal;
      }

      const costRef = costRefById.get(item.id);
      if (costRef !== undefined) {
        data.costRefCode = costRef;
      }

      if (Object.keys(data).length === 0) continue;

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data,
      });

      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
        // `updated` keeps its original meaning (rate writes) so the existing
        // report stays truthful; a cost-ref-only item still lands in
        // `updatedItems` so the client repaints the cell.
        if (rate !== undefined) updated++;
      }
    }

    const costRef = costRefPlan ?? {
      fills: [],
      filled: 0,
      multi: 0,
      noMatch: 0,
      alreadySet: 0,
    };

    console.log(
      `[fetch-cr-rates] items=${items.length} rateUpdated=${updated} itemsTouched=${updatedItems.length} costRefFilled=${costRef.filled} costRefMulti=${costRef.multi} costRefNoMatch=${costRef.noMatch} costRefAlreadySet=${costRef.alreadySet}`,
    );

    if (updatedItems.length === 0) {
      return {
        success: false,
        error: "No matching contract review rows found for the selected items.",
        costRefFilled: 0,
        costRefMulti: costRef.multi,
        costRefNoMatch: costRef.noMatch,
        costRefAlreadySet: costRef.alreadySet,
      };
    }
    return {
      success: true,
      data: {
        items: updatedItems,
        updated,
        costRefFilled: costRef.filled,
        costRefMulti: costRef.multi,
        costRefNoMatch: costRef.noMatch,
        costRefAlreadySet: costRef.alreadySet,
      },
    };
  } catch (error: any) {
    console.error("Error fetching contract review rates:", error);
    return { success: false, error: error.message || "Failed to fetch contract review rates." };
  }
}

// Calculate and populate pdcostValidation % for selected items that have contractReviewRate and productCost
export async function populatePdCostValidationAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, contractReviewRate: true, productCost: true },
    });

    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;

    for (const item of items) {
      if (!item.contractReviewRate || item.productCost == null) continue;
      const cr = parseFloat(String(item.contractReviewRate).replace(/,/g, ""));
      const pc = Number(item.productCost);
      if (isNaN(cr) || isNaN(pc) || pc === 0) continue;

      const pdVal = `${(((cr - pc) / pc) * 100).toFixed(2)}%`;
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { pdcostValidation: pdVal },
      });

      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
        updated++;
      }
    }

    if (updated === 0) {
      return {
        success: false,
        error: "No items with both Contract Review Rate and Product Cost found to populate PD %.",
      };
    }

    return { success: true, data: { items: updatedItems, updated } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to populate PD Cost Validation.";
    return { success: false, error: message };
  }
}

// Clear Quoted Rate (and derived columns: GST, totalValue, itemWiseTotalValue) for filtered items. VA% is preserved.
export async function clearQuotedRatesAction(itemIds: string[]) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }
    const uniqueIds = [...new Set(itemIds)];

    const existing = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, enquiryId: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }
    // Skip items whose parent enquiry is frozen (quotedRate / totals are frozen fields)
    let clearIds = uniqueIds;
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const enquiryIds = [...new Set(existing.map((e) => e.enquiryId))];
      const parents = await prisma.enquiry.findMany({
        where: { id: { in: enquiryIds } },
        select: { id: true, apm: true, offerPdfGeneratedAt: true },
      });
      const frozenParents = new Set(parents.filter((p) => isEnquiryFrozen(p.apm, p.offerPdfGeneratedAt)).map((p) => p.id));
      const frozenItemIds = new Set(existing.filter((e) => frozenParents.has(e.enquiryId)).map((e) => e.id));
      if (frozenItemIds.size > 0) {
        clearIds = uniqueIds.filter((id) => !frozenItemIds.has(id));
        if (clearIds.length === 0) {
          return { success: false, error: `Cannot clear rates: all ${frozenItemIds.size} matching item(s) are frozen after one-time PDF generation.` };
        }
      }
    }

    console.log(`[Server] clearQuotedRates ids=${clearIds.length}`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: clearIds } },
      data: {
        quotedRate: null,
        quotedRateGst: null,
        itemWiseTotalValue: null,
        totalValue: null,
      },
    });

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: clearIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), cleared: updatedItems.length, skippedFrozen: uniqueIds.length - clearIds.length } };
  } catch (error: any) {
    console.error("Error clearing quoted rates:", error);
    return { success: false, error: error.message || "Failed to clear quoted rates." };
  }
}

// Bulk update apm for many enquiries (all pages, filtered scope). Allowed values: "Yes", "No", null/"" for clear.
// Now enquiry-based after migration add_apm_in_enquiry. Gated to admin/developer.
export async function bulkUpdateApmAction(enquiryIds: string[], apm: string | null) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    const { auth } = await import("@/auth")
    const session = await auth()
    const role = (session?.user as any)?.role
    if (!session || !["admin", "developer"].includes(role)) {
      return { success: false, error: "Unauthorized: admin or developer only can set APM" }
    }
    if (!enquiryIds || enquiryIds.length === 0) {
      return { success: false, error: "No enquiries selected." };
    }
    const uniqueIds = [...new Set(enquiryIds)];
    const normalized = apm === "" ? null : apm;
    if (normalized !== null && normalized !== "Yes" && normalized !== "No") {
      return { success: false, error: "APM must be Yes, No, or blank." };
    }

    const existing = await prisma.enquiry.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some enquiries not found. Please refresh and try again." };
    }

    console.log(`[Server] bulkApm enquiries=${uniqueIds.length} set="${normalized ?? ""}"`);

    const bulkData: Record<string, any> = { apm: normalized };
    if (normalized !== "Yes") {
      bulkData.offerPdfGeneratedAt = null;
      bulkData.offerPdfGeneratedBy = null;
    }
    await prisma.enquiry.updateMany({
      where: { id: { in: uniqueIds } },
      data: bulkData,
    });

    const updatedEnquiries = await prisma.enquiry.findMany({
      where: { id: { in: uniqueIds } },
      include: { items: { orderBy: { position: "asc" } }, attachments: true },
    });

    return { success: true, data: { enquiries: updatedEnquiries.map(serializeEnquiry), updated: updatedEnquiries.length, apm: normalized } };
  } catch (error: any) {
    console.error("Error bulk updating apm:", error);
    return { success: false, error: error.message || "Failed to update APM." };
  }
}

// Bulk update validation for many items (all pages, filtered scope). Allowed values: "Yes", "No", null/"" for clear.
export async function bulkUpdateValidationAction(itemIds: string[], validation: string | null) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }
    const uniqueIds = [...new Set(itemIds)];
    const normalized = validation === "" ? null : validation;
    if (normalized !== null && normalized !== "Yes" && normalized !== "No") {
      return { success: false, error: "Validation must be Yes, No, or blank." };
    }

    const existing = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, enquiryId: true, validation: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    console.log(`[Server] bulkValidation ids=${uniqueIds.length} set="${normalized ?? ""}"`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: { validation: normalized },
    });
    const { logItemChanges } = await import("@/lib/itemChangeLog");
    await logItemChanges(
      existing.map((e) => ({ itemId: e.id, enquiryId: e.enquiryId, field: "validation", oldValue: e.validation, newValue: normalized })),
    );

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), updated: updatedItems.length, validation: normalized } };
  } catch (error: any) {
    console.error("Error bulk updating validation:", error);
    return { success: false, error: error.message || "Failed to update validation." };
  }
}

export async function createGeneratedImageAction(data: {
  itemType: string;
  operationType: string;
  rmType: string;
}) {
  "use server";
  await requireAccess();
  const itemType = data.itemType?.trim();
  const operationType = data.operationType?.trim();
  const rmType = data.rmType?.trim();
  if (!itemType || !operationType || !rmType) {
    return { success: false, error: "itemType, operationType and rmType are required." };
  }
  const imageKey = makeImageKey(itemType, operationType, rmType);
  try {
    const existing = await prisma.generatedImage.findUnique({ where: { imageKey } });
    if (existing) {
      return { success: false, error: `An entry with imageKey "${imageKey}" already exists.` };
    }
    const created = await prisma.generatedImage.create({
      data: {
        itemType,
        operationType,
        rmType,
        imageKey,
        status: "pending",
      },
    });
    return { success: true, data: created };
  } catch (error: any) {
    if (error?.code === "P2002") {
      return { success: false, error: "Duplicate imageKey â€” an entry for this combination already exists." };
    }
    return { success: false, error: error?.message || "Failed to create entry." };
  }
}

export async function uploadGeneratedImageAction(
  id: string,
  payload: { fileName: string; mimeType: string; base64Data: string }
) {
  "use server";
  await requireAccess();
  if (!id) return { success: false, error: "Missing id." };
  const { fileName, mimeType, base64Data } = payload;
  if (!fileName || !mimeType || !base64Data) {
    return { success: false, error: "Missing file data." };
  }
  // Basic mime check
  if (!mimeType.startsWith("image/")) {
    return { success: false, error: "Only image files are allowed." };
  }
  try {
    const existing = await prisma.generatedImage.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Record not found." };

    const { fileId, url } = await uploadFileToDrive(fileName, mimeType, base64Data);

    const updated = await prisma.generatedImage.update({
      where: { id },
      data: {
        url,
        driveFileId: fileId,
        status: "ready",
        error: null,
        generatedAt: new Date(),
      },
    });
    return { success: true, data: updated, url, driveFileId: fileId };
  } catch (error: any) {
    console.error("uploadGeneratedImageAction failed:", error);
    return { success: false, error: error?.message || "Upload failed." };
  }
}

export async function uploadImageForComboAction(data: {
  itemType: string;
  operationType: string;
  rmType: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}) {
  "use server";
  await requireAccess();
  const itemType = data.itemType?.trim();
  const operationType = data.operationType?.trim();
  const rmType = data.rmType?.trim();
  const { fileName, mimeType, base64Data } = data;
  if (!itemType || !operationType || !rmType) {
    return { success: false, error: "itemType, operationType and rmType are required." };
  }
  if (!fileName || !mimeType || !base64Data) {
    return { success: false, error: "Missing file data." };
  }
  if (!mimeType.startsWith("image/")) {
    return { success: false, error: "Only image files are allowed." };
  }
  const imageKey = makeImageKey(itemType, operationType, rmType);
  try {
    const { fileId, url } = await uploadFileToDrive(fileName, mimeType, base64Data);

    const upserted = await prisma.generatedImage.upsert({
      where: { imageKey },
      update: {
        itemType,
        operationType,
        rmType,
        url,
        driveFileId: fileId,
        status: "ready",
        error: null,
        generatedAt: new Date(),
      },
      create: {
        itemType,
        operationType,
        rmType,
        imageKey,
        url,
        driveFileId: fileId,
        status: "ready",
        generatedAt: new Date(),
      },
    });
    return { success: true, data: upserted, url, driveFileId: fileId };
  } catch (error: any) {
    console.error("uploadImageForComboAction failed:", error);
    return { success: false, error: error?.message || "Upload failed." };
  }
}


export type ErpItemUpdateType =
  | "RenameItems"
  | "Close items"
  | "Open items"
  | "Open and rename items";

/** Payload row — `itemname` is sent by RenameItems only. */
type ErpItemUpdateRow = { itemcode: string; itemname?: string };

/**
 * Selects `RawMaterial` rows and POSTs `{ type, items }` to the
 * "[GMD]Update Erp Item" n8n webhook (`N8N_ERP_ITEM_WEBHOOK_URL`). The n8n Code
 * node renders the mail body per `type`; this action only shapes the payload.
 */
export async function sendErpItemUpdateAction(
  type: ErpItemUpdateType = "RenameItems",
): Promise<{ success: boolean; sent: number; error?: string }> {
  await requireAccess();
  const webhookUrl = process.env.N8N_ERP_ITEM_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[erp-item-update] N8N_ERP_ITEM_WEBHOOK_URL not set, skipping send");
    return { success: false, sent: 0, error: "Webhook not configured (N8N_ERP_ITEM_WEBHOOK_URL)." };
  }

  try {
    let items: ErpItemUpdateRow[];

    if (type === "RenameItems") {
      // Live rows (status not closed) whose derived item name differs from the
      // ERP auto name; the derived name travels as `itemname`.
      const rows = await prisma.rawMaterial.findMany({
        select: {
          erpItemCode: true,
          itemNameAuto: true,
          itemNameDerived: true,
          newItemStatus: true,
        },
      });

      items = rows
        .filter(
          (r) =>
            !ERP_CLOSED_STATUSES.has(
              (r.newItemStatus ?? "").trim().toUpperCase(),
            ),
        )
        .filter((r) => {
          const derived = (r.itemNameDerived ?? "").trim();
          return derived !== "" && derived !== (r.itemNameAuto ?? "").trim();
        })
        .map((r) => ({
          itemcode: (r.erpItemCode ?? "").trim(),
          itemname: (r.itemNameDerived ?? "").trim(),
        }))
        .filter((r) => r.itemcode !== "");
    } else if (type === "Close items") {
      // Closed rows not yet marked in batch C. Item code only.
      const rows = await prisma.rawMaterial.findMany({
        select: { erpItemCode: true, newItemStatus: true, cBatch: true },
      });

      items = rows
        .filter((r) =>
          ERP_CLOSED_STATUSES.has((r.newItemStatus ?? "").trim().toUpperCase()),
        )
        .filter((r) => (r.cBatch ?? "").trim().toUpperCase() !== C_BATCH_VALUE)
        .map((r) => ({ itemcode: (r.erpItemCode ?? "").trim() }))
        .filter((r) => r.itemcode !== "");
    } else {
      // shortcut: Open items / Open and rename items need their own row rules.
      return { success: false, sent: 0, error: `Selection logic for "${type}" is not implemented yet.` };
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, items }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[erp-item-update] send failed", { type, status: response.status, body });
      return { success: false, sent: 0, error: `n8n responded ${response.status}` };
    }

    console.log("[erp-item-update] sent", { type, count: items.length });
    return { success: true, sent: items.length };
  } catch (error: any) {
    console.error("[erp-item-update] error", error);
    return {
      success: false,
      sent: 0,
      error: error?.message || "Failed to reach the ERP item-update webhook.",
    };
  }
}

/**
 * Notifies n8n to open (re-activate) a single reopened raw material — fired when
 * a row's NEW ITEM STATUS falls from CLOSED / TO BE CLOSED / TO BE LOCKED to
 * blank. Sends "Open and rename items" when the derived name differs from the ERP
 * auto name, otherwise "Open items". One item, one email.
 */
export async function sendOpenItemsAction(
  erpItemCode: string,
): Promise<{ success: boolean; sent: number; type?: ErpItemUpdateType; error?: string }> {
  await requireAccess();
  const webhookUrl = process.env.N8N_ERP_ITEM_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[erp-item-open] N8N_ERP_ITEM_WEBHOOK_URL not set, skipping send");
    return { success: false, sent: 0, error: "Webhook not configured (N8N_ERP_ITEM_WEBHOOK_URL)." };
  }

  const code = (erpItemCode ?? "").trim();
  if (!code) return { success: false, sent: 0, error: "Missing item code." };

  try {
    const row = await prisma.rawMaterial.findUnique({
      where: { erpItemCode: code },
      select: { itemNameAuto: true, itemNameDerived: true },
    });
    if (!row) return { success: false, sent: 0, error: `Raw material ${code} not found.` };

    const derived = (row.itemNameDerived ?? "").trim();
    const rename = derived !== "" && derived !== (row.itemNameAuto ?? "").trim();
    const type: ErpItemUpdateType = rename ? "Open and rename items" : "Open items";
    const items: ErpItemUpdateRow[] = rename
      ? [{ itemcode: code, itemname: derived }]
      : [{ itemcode: code }];

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, items }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("[erp-item-open] send failed", { code, type, status: response.status, body });
      return { success: false, sent: 0, type, error: `n8n responded ${response.status}` };
    }

    console.log("[erp-item-open] sent", { code, type });
    return { success: true, sent: 1, type };
  } catch (error: any) {
    console.error("[erp-item-open] error", error);
    return {
      success: false,
      sent: 0,
      error: error?.message || "Failed to reach the ERP item-update webhook.",
    };
  }
}
