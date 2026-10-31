"use server";
import { requireAccess } from "@/lib/access";
import { C_BATCH_VALUE } from "@/lib/erpItemStatus";
import { columnAccess } from "@gmd/contract-review/flags";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import { getDistinctBomIds, getBomRmAvailBatch, resolveContractReviewBomIdsFromActuator, computeContractReviewRmAvail, findBomForItem } from "@/lib/verifyBomLookup";
import { splitCsvLinks } from "@/lib/gmd_lib/contract-order-links";

export async function selectContractReviewBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  await requireAccess();
  if (!columnAccess(await getContractReviewFlags()).isEditable("BOM ID")) {
    return { success: false, error: "Not allowed in this app." };
  }
  try {
    const item = await tenderPrisma.contractReview.findUnique({
      where: { id },
      select: { itemCode: true },
    });
    if (!item) return { success: false, error: "Item not found." };
    const value = bomId?.trim() || null;
    if (value) {
      const ids = await getDistinctBomIds(item.itemCode);
      if (!ids.includes(value)) {
        return { success: false, error: "Selected BOM ID is not in available options." };
      }
      const vbRow = await findBomForItem(item.itemCode, value);
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await tenderPrisma.contractReview.findMany({
        where: { bomId: value },
        select: { id: true, bomId: true, orderQty: true },
      });
      const bomAvail = await getBomRmAvailBatch([value]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(id) ?? "";
      await tenderPrisma.contractReview.update({
        where: { id },
        data: { bomId: value, itemType, noUse: noUse || null },
      });
      return { success: true, data: { id, bomId: value, itemType, noUse } };
    }
    await tenderPrisma.contractReview.update({
      where: { id },
      data: { bomId: null, noUse: null },
    });
    return { success: true, data: { id, bomId: null } };
  } catch (error: any) {
    console.error("Error selecting ContractReview BOM ID:", error);
    return { success: false, error: error.message || "Failed to select BOM ID." };
  }
}

export async function autoAssignContractReviewBomIdFromActuator(ids: string[]) {
  "use server";
  await requireAccess();
  if (!columnAccess(await getContractReviewFlags()).isEditable("BOM ID")) {
    return { success: false, error: "Not allowed in this app." };
  }
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const rows = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, actuator: true, bomId: true, orderQty: true },
    });
    const unresolved = rows.filter((r) => r.actuator?.includes("@"));
    const bomIdByRow = await resolveContractReviewBomIdsFromActuator(unresolved);

    const results: { id: string; bomId: string; itemType: string; noUse: string | null }[] = [];
    for (const row of unresolved) {
      const bomId = bomIdByRow.get(row.id);
      if (!bomId) continue;
      if (row.bomId === bomId) continue;
      const vbRow = await findBomForItem(row.itemCode, bomId);
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await tenderPrisma.contractReview.findMany({
        where: { bomId },
        select: { id: true, bomId: true, orderQty: true },
      });
      if (!groupRows.some((g) => g.id === row.id)) {
        groupRows.push({ id: row.id, bomId, orderQty: row.orderQty });
      }
      const bomAvail = await getBomRmAvailBatch([bomId]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(row.id) ?? null;
      await tenderPrisma.contractReview.update({
        where: { id: row.id },
        data: { bomId, itemType, noUse: noUse || null },
      });
      results.push({ id: row.id, bomId, itemType, noUse });
    }
    return { success: true, data: results };
  } catch (error: any) {
    console.error("Error auto-assigning ContractReview BOM ID from actuator:", error);
    return {
      success: false,
      error: error.message || "Failed to auto-assign BOM ID from actuator.",
    };
  }
}

export async function backfillContractReviewNoUseBatchAction(ids: string[]) {
  "use server";
  await requireAccess();
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, bomId: true, orderQty: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        items.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(items, bomAvail);
    const updates = items
      .filter((i) => availMap.has(i.id))
      .filter((i) => (availMap.get(i.id) ?? null) !== (i.noUse ?? null))
      .map((i) =>
        tenderPrisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (updates.length > 0) {
      await tenderPrisma.$transaction(updates, { timeout: 30_000 });
    }
    return {
      success: true,
      data: items
        .filter((i) => availMap.has(i.id))
        .map((i) => ({
          id: i.id,
          noUse: availMap.get(i.id) ?? null,
        })),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview RM AVAIL:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill RM AVAIL.",
    };
  }
}

export async function backfillContractReviewOrderListBatchAction(ids: string[]) {
  "use server";
  await requireAccess();
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, orderList: true },
    });
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();
    const codes = [
      ...new Set(
        items
          .map((i) => i.itemCode)
          .filter((c): c is string => !!c && c.trim() !== "")
          .map(normalize),
      ),
    ];
    let supplyMap = new Map<string, string[]>();
    if (codes.length > 0) {
      const supplyRows = await prisma.supplyHistoryItem.findMany({
        where: { erpItemCode: { in: codes } },
        select: { erpItemCode: true, orderList: true },
      });
      for (const row of supplyRows) {
        if (!row.erpItemCode) continue;
        const key = normalize(row.erpItemCode);
        const links = splitCsvLinks(row.orderList);
        if (links.length === 0) continue;
        const set = new Set(supplyMap.get(key) ?? []);
        for (const l of links) set.add(l);
        supplyMap.set(key, [...set]);
      }
    }
    const updates = items
      .map((item) => {
        const key = normalize(item.itemCode);
        const incoming = supplyMap.get(key) ?? [];
        if (incoming.length === 0) return null;
        const merged = [...new Set([...(item.orderList ?? []), ...incoming])];
        if (merged.length <= (item.orderList?.length ?? 0)) return null;
        return {
          id: item.id,
          promise: tenderPrisma.contractReview.update({
            where: { id: item.id },
            data: { orderList: merged },
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map((u) => u.promise));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[backfill ORDER LIST] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
            );
          }
        });
      }
    }
    return {
      success: true,
      data: items.map((item) => {
        const key = normalize(item.itemCode);
        const incoming = supplyMap.get(key) ?? [];
        const merged = [...new Set([...(item.orderList ?? []), ...incoming])];
        return { id: item.id, orderList: merged };
      }),
    };
  } catch (error: any) {
    console.error("Error backfilling ContractReview ORDER LIST:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill ORDER LIST.",
    };
  }
}

export async function syncContractReviewEnquiryFieldsBatchAction(ids: string[]) {
  "use server";
  await requireAccess();
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };

    const { normalizeContractKey } = await import(
      "@/lib/gmd_lib/contract-review-enquiry-backfill"
    );

    const enquiries = await prisma.enquiry.findMany({
      where: {
        selectedContractNo: { isEmpty: false },
      },
      select: {
        selectedContractNo: true,
        state: true,
        utility: true,
        projectReference: true,
        enquiryDate: true,
        createdAt: true,
      },
      orderBy: [{ enquiryDate: "desc" }, { createdAt: "desc" }],
    });

    const byContract = new Map<
      string,
      { state: string | null; utility: string | null; projectReference: string | null }
    >();
    for (const eq of enquiries) {
      for (const cn of eq.selectedContractNo ?? []) {
        const key = normalizeContractKey(cn);
        if (!key || byContract.has(key)) continue;
        byContract.set(key, {
          state: eq.state ?? null,
          utility: eq.utility ?? null,
          projectReference: eq.projectReference ?? null,
        });
      }
    }

    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        contractNo: true,
        state: true,
        utility: true,
        projectReference: true,
      },
    });

    const updates: Array<{
      where: { id: string };
      data: { state: string | null; utility: string | null; projectReference: string | null };
    }> = [];

    const returnData: Array<{
      id: string;
      state: string | null;
      utility: string | null;
      projectReference: string | null;
    }> = [];

    for (const item of items) {
      const match = byContract.get(normalizeContractKey(item.contractNo));
      const targetState = match?.state ?? null;
      const targetUtility = match?.utility ?? null;
      const targetProjectReference = match?.projectReference ?? null;

      returnData.push({
        id: item.id,
        state: targetState,
        utility: targetUtility,
        projectReference: targetProjectReference,
      });

      const changed =
        (item.state ?? null) !== targetState ||
        (item.utility ?? null) !== targetUtility ||
        (item.projectReference ?? null) !== targetProjectReference;

      if (changed) {
        updates.push({
          where: { id: item.id },
          data: {
            state: targetState,
            utility: targetUtility,
            projectReference: targetProjectReference,
          },
        });
      }
    }

    if (updates.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await tenderPrisma.$transaction(
          chunk.map((u) =>
            tenderPrisma.contractReview.update({
              where: u.where,
              data: u.data,
            }),
          ),
          { timeout: 30_000 },
        );
      }
    }

    return {
      success: true,
      data: returnData,
    };
  } catch (error: any) {
    console.error("Error syncing ContractReview enquiry fields:", error);
    return {
      success: false,
      error: error.message || "Failed to sync enquiry fields.",
    };
  }
}

export async function syncContractReviewEnquiryFieldsAllAction() {
  "use server";
  await requireAccess();
  try {
    const {
      computeContractReviewEnquiryBackfill,
      applyContractReviewEnquiryBackfill,
    } = await import("@/lib/gmd_lib/contract-review-enquiry-backfill");

    const result = await computeContractReviewEnquiryBackfill(prisma);
    const updated = await applyContractReviewEnquiryBackfill(prisma, result.rows);

    return {
      success: true,
      data: {
        changed: result.rows.length,
        matched: result.matched,
        unmatched: result.unmatched,
        updated,
      },
    };
  } catch (error: any) {
    console.error("Error syncing all ContractReview enquiry fields:", error);
    return {
      success: false,
      error: error.message || "Failed to sync enquiry fields.",
    };
  }
}

export async function backfillContractReviewCostFromQuotationAction(
  ids: string[],
) {
  "use server";
  await requireAccess();
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await tenderPrisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        contractNo: true,
        itemCode: true,
        rate: true,
        costfromQuotation: true,
        vaPercentfromcost: true,
      },
    });
    const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toUpperCase();
    const codes = [
      ...new Set(
        items
          .map((i) => i.itemCode)
          .filter((c): c is string => !!c && c.trim() !== "")
          .map(normalize),
      ),
    ];

    // Walk the enquiryId relation: each item's parent enquiry provides the
    // selectedContractNo + recency, so an item is only ever attributed to a
    // contract its own enquiry actually selected.
    const matches = await prisma.enquiryItem.findMany({
      where: { erpItemCode: { in: codes } },
      select: {
        erpItemCode: true,
        cost: true,
        enquiry: {
          select: {
            selectedContractNo: true,
            enquiryDate: true,
            createdAt: true,
          },
        },
      },
    });

    const bestByKey = new Map<
      string,
      { cost: string | null; recency: number }
    >();
    for (const m of matches) {
      if (!m.erpItemCode || !m.enquiry) continue;
      const itemKey = normalize(m.erpItemCode);
      const recency =
        m.enquiry.enquiryDate?.getTime() ?? m.enquiry.createdAt.getTime() ?? 0;
      for (const cn of m.enquiry.selectedContractNo ?? []) {
        const key = normalize(cn) + "||" + itemKey;
        const prev = bestByKey.get(key);
        if (prev && prev.recency >= recency) continue;
        bestByKey.set(key, {
          cost: m.cost !== null && m.cost !== undefined ? String(m.cost) : null,
          recency,
        });
      }
    }

    const computeVa = (cost: string | null, rate: string | null): string | null => {
      const costNum = Number(cost);
      if (isNaN(costNum) || costNum === 0) return null;
      const rateNum = parseFloat(String(rate ?? "").replace(/,/g, ""));
      const r = isNaN(rateNum) ? 0 : rateNum;
      return `${(((r - costNum) / costNum) * 100).toFixed(2)}%`;
    };

    const updates = items
      .map((item) => {
        const key = normalize(item.contractNo) + "||" + normalize(item.itemCode);
        const best = bestByKey.get(key);
        if (!best) return null;
        const cost = best.cost ?? null;
        const va = computeVa(cost, item.rate ?? null);
        const data: Record<string, string | null> = {};
        if (item.costfromQuotation !== cost) data.costfromQuotation = cost;
        if (item.vaPercentfromcost !== va) data.vaPercentfromcost = va;
        if (Object.keys(data).length === 0) return null;
        return {
          id: item.id,
          promise: tenderPrisma.contractReview.update({
            where: { id: item.id },
            data,
          }),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    if (updates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map((u) => u.promise));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[backfill COST FROM QUOTATION] update failed id=${chunk[idx].id} err=${(r.reason as Error)?.message}`,
            );
          }
        });
      }
    }

    const data = items
      .map((item) => {
        const key = normalize(item.contractNo) + "||" + normalize(item.itemCode);
        const best = bestByKey.get(key);
        if (!best) return null;
        const cost = best.cost ?? null;
        return {
          id: item.id,
          costfromQuotation: cost,
          vaPercentfromcost: computeVa(cost, item.rate ?? null),
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    return { success: true, data };
  } catch (error: any) {
    console.error("Error backfilling ContractReview COST FROM QUOTATION:", error);
    return {
      success: false,
      error: error.message || "Failed to backfill COST FROM QUOTATION.",
    };
  }
}

export async function updateIndentRmCodeAction(input: {
  sourceIds: string[];
  slot: 1 | 2 | 3 | 4;
  value: string;
}): Promise<{ success: boolean; updated?: number; error?: string }> {
  "use server";
  await requireAccess();
  try {
    const sourceIds = (input.sourceIds ?? []).filter(
      (id) => typeof id === "string" && id.trim() !== "",
    );
    const slot = Number(input.slot);
    if (sourceIds.length === 0) {
      return { success: false, error: "No stored rows behind this line." };
    }
    if (![1, 2, 3, 4].includes(slot)) {
      return { success: false, error: "Invalid variant slot." };
    }

    const value = String(input.value ?? "").trim();
    if (value !== "") {
      const { LIVE_RM_WHERE } = await import("@/lib/indentRmCodeResolver");
      const { rmOptionFitsIndentRow } = await import("@/lib/indentRmCodeOptions");
      const codes = [...new Set(value.split(",").map((c) => c.trim()).filter(Boolean))];
      const [masters, targets] = await Promise.all([
        prisma.rawMaterial.findMany({
          where: { erpItemCode: { in: codes }, ...LIVE_RM_WHERE },
          select: { erpItemCode: true, l2ValveType: true, l3Dia: true },
        }),
        prisma.indentListing.findMany({
          where: { id: { in: sourceIds } },
          select: { item: true, size: true },
        }),
      ]);
      const byCode = new Map(masters.map((m) => [m.erpItemCode, m]));
      for (const code of codes) {
        const m = byCode.get(code);
        if (!m) {
          return { success: false, error: `RM code ${code} is not a live raw material.` };
        }
        const option = { valveType: m.l2ValveType ?? "", size: m.l3Dia ?? "" };
        const bad = targets.find((t) => !rmOptionFitsIndentRow(option, t.item, t.size));
        if (bad) {
          return {
            success: false,
            error: `RM code ${code} (${option.valveType || "no type"} ${option.size}) does not fit ${bad.item ?? "this item"} ${bad.size ?? ""}.`,
          };
        }
      }
    }
    // Every stored row behind the displayed line gets the same value: a
    // TPAV+SLV compound is folded into the SLV/TPAV rows it contributes to.
    const result = await prisma.indentListing.updateMany({
      where: { id: { in: sourceIds } },
      data: { [`rmCodeV${slot}`]: value },
    });
    return { success: true, updated: result.count };
  } catch (error: any) {
    console.error("Error updating IndentListing RM code:", error);
    return {
      success: false,
      error: error.message || "Failed to update the RM code.",
    };
  }
}

export async function recomputeIndentListingVersionsAction() {
  "use server";
  await requireAccess();
  try {
    const { planIndentRecompute, parseItem } = await import(
      "@/lib/itemVersionResolver"
    );
    const rows = await prisma.indentListing.findMany({
      select: {
        id: true,
        item: true,
        size: true,
        pnRating: true,
        mcReceivedPending: true,
        totalBalBillAgCont: true,
        v1: true,
        v2: true,
        v3: true,
        v4: true,
        v1Category: true,
        v2Category: true,
        v3Category: true,
        v4Category: true,
      },
    });

    // A recompute collapses `item` down to the base item ("SLV", "BFV", ...),
    // which is what makes the merge work â€” but it also destroys the variant
    // suffixes the V1..V4 split was derived from. Once that has happened the
    // split cannot be rebuilt, so re-running the recompute on an already
    // collapsed table would funnel every balance into V1 and wipe the
    // categories. Detect that state and skip the destructive pass: the
    // intended cycle is Sync from Contract Review (which restores the full
    // item names) and only then Recompute.
    const hasUnexplodedVariants = rows.some(
      (r) => parseItem(r.item).hasVersionExtras,
    );

    let updated = 0;
    let deleted = 0;
    let recomputeSkipped = false;

    if (hasUnexplodedVariants) {
      const { updates, deletes } = planIndentRecompute(rows);
      const syncedAt = new Date();

      // Only write rows where the derived values actually differ from what is
      // currently stored â€” never rewrite already-correct rows.
      const currentById = new Map(rows.map((r) => [r.id, r]));
      const realUpdates = updates.filter((u) => {
        const cur = currentById.get(u.id);
        if (!cur) return true;
        return (
          String(cur.item ?? "") !== u.item ||
          String(cur.pnRating ?? "") !== u.pnRating ||
          Number(cur.totalBalBillAgCont ?? 0) !== u.totalBalBillAgCont ||
          String(cur.v1 ?? "") !== u.v1 ||
          String(cur.v2 ?? "") !== u.v2 ||
          String(cur.v3 ?? "") !== u.v3 ||
          String(cur.v4 ?? "") !== u.v4 ||
          String(cur.v1Category ?? "") !== u.v1Category ||
          String(cur.v2Category ?? "") !== u.v2Category ||
          String(cur.v3Category ?? "") !== u.v3Category ||
          String(cur.v4Category ?? "") !== u.v4Category
        );
      });

      if (realUpdates.length > 0 || deletes.length > 0) {
        await prisma.$transaction([
          ...realUpdates.map((u) =>
            prisma.indentListing.update({
              where: { id: u.id },
              data: {
                item: u.item,
                pnRating: u.pnRating,
                totalBalBillAgCont: u.totalBalBillAgCont,
                v1: u.v1,
                v2: u.v2,
                v3: u.v3,
                v4: u.v4,
                v1Category: u.v1Category,
                v2Category: u.v2Category,
                v3Category: u.v3Category,
                v4Category: u.v4Category,
                syncedAt,
              },
            }),
          ),
          ...deletes.map((id) => prisma.indentListing.delete({ where: { id } })),
        ]);
      }

      updated = realUpdates.length;
      deleted = deletes.length;
      console.log(
        `[indent-listing-recompute] rows=${rows.length} planned=${updates.length} realUpdates=${realUpdates.length} deletes=${deletes.length}`,
      );
    } else {
      recomputeSkipped = true;
      console.log(
        `[indent-listing-recompute] skipped: no row still carries a variant suffix, so the table is already collapsed. Re-sync from Contract Review before recomputing.`,
      );
    }

    // Reload so the RM code pass sees the state actually on disk rather than a
    // mix of pre- and post-recompute values. The variant categories are read too
    // because they carry the body material ("Rising CS" = cast/carbon steel),
    // which the collapsed `item` no longer records.
    const freshRows = await prisma.indentListing.findMany({
      select: {
        id: true,
        item: true,
        size: true,
        pnRating: true,
        v1: true,
        v2: true,
        v3: true,
        v4: true,
        v1Category: true,
        v2Category: true,
        v3Category: true,
        v4Category: true,
      },
    });

    const {
      planIndentRmCodes,
      planRmCodeWrites,
      LIVE_RM_WHERE,
      RM_CODE_ITEM_CATEGORY,
      RM_CODE_VALVE_TYPES,
    } = await import("@/lib/indentRmCodeResolver");

    const [rmCodeSourceRows, rawMaterials] = await Promise.all([
      prisma.indentListing.findMany({
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          v1: true,
          v2: true,
          v3: true,
          v4: true,
          v1Category: true,
          v2Category: true,
          v3Category: true,
          v4Category: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      }),
      // Only live raw materials: CLOSED history rows share the same L-values
      // and would match nearly every indent row.
      prisma.rawMaterial.findMany({
        where: {
          l8ItemCategory: {
            contains: RM_CODE_ITEM_CATEGORY,
            mode: "insensitive",
          },
          l2ValveType: {
            in: [...RM_CODE_VALVE_TYPES],
            mode: "insensitive",
          },
          ...LIVE_RM_WHERE,
        },
        select: {
          erpItemCode: true,
          itemNameAuto: true,
          availableStock: true,
          l2ValveType: true,
          l3Dia: true,
          l4Component: true,
          l5Material: true,
          l6Std: true,
          l7Dimension: true,
          l8ItemCategory: true,
        },
      }),
    ]);

    const rmCodePlan = planIndentRmCodes(rmCodeSourceRows, rawMaterials);
    const rmCodeCurrentById = new Map(rmCodeSourceRows.map((r) => [r.id, r]));
    // Only blank slots are filled: curated / hand-picked codes are never overwritten.
    const rmCodeWrites = planRmCodeWrites(
      rmCodePlan.updates,
      rmCodeCurrentById,
    );

    // syncedAt is deliberately left alone here: it tracks the Contract Review
    // sync, and an RM code pass is not a Contract Review sync.
    if (rmCodeWrites.length > 0) {
      await prisma.$transaction(
        rmCodeWrites.map((w) => {
          const { id, ...data } = w;
          return prisma.indentListing.update({ where: { id }, data });
        }),
      );
    }

    console.log(
      `[indent-listing-rmcode] rawMaterials=${rawMaterials.length} rows=${rmCodePlan.updates.length} written=${rmCodeWrites.length} resolved=${rmCodePlan.resolved} ambiguous=${rmCodePlan.ambiguous} unmatched=${rmCodePlan.unmatched}`,
    );

    // Phase 3: publish the RM codes just written onto the Contract Review
    // COST CODE REF column. This reads rmCodeV1..V4 back from disk rather than
    // reusing `rmCodeWrites`, so a slot that matched several raw materials
    // lands on the contract exactly as the Indent Listing displays it.
    const { planContractCostCodeRefs } = await import(
      "@/lib/contractCostCodeRefResolver"
    );

    const [contractCostRefRows, indentRmCodeRows] = await Promise.all([
      // `item` is what drives the indent pipeline and what the join parses into
      // a base item + variant slot, so rows without one can never match.
      tenderPrisma.contractReview.findMany({
        where: { item: { not: null } },
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          costCodeRef: true,
        },
      }),
      prisma.indentListing.findMany({
        select: {
          id: true,
          item: true,
          size: true,
          pnRating: true,
          mcReceivedPending: true,
          rmCodeV1: true,
          rmCodeV2: true,
          rmCodeV3: true,
          rmCodeV4: true,
        },
      }),
    ]);

    const costCodeRefPlan = planContractCostCodeRefs(
      contractCostRefRows,
      indentRmCodeRows,
    );
    const costCodeRefCurrentById = new Map(
      contractCostRefRows.map((r) => [r.id, r]),
    );
    const costCodeRefUpdates = costCodeRefPlan.updates.filter((u) => {
      const cur = costCodeRefCurrentById.get(u.id);
      if (!cur) return false;
      return (cur.costCodeRef ?? null) !== u.costCodeRef;
    });

    // syncedAt is left alone for the same reason as the RM code pass above: it
    // tracks the Contract Review sync, not this derived column.
    if (costCodeRefUpdates.length > 0) {
      await tenderPrisma.$transaction(
        costCodeRefUpdates.map((u) =>
          tenderPrisma.contractReview.update({
            where: { id: u.id },
            data: { costCodeRef: u.costCodeRef },
          }),
        ),
        { timeout: 30_000 },
      );
    }

    console.log(
      `[contract-review-costcoderef] contractRows=${contractCostRefRows.length} indentRows=${indentRmCodeRows.length} written=${costCodeRefUpdates.length} resolved=${costCodeRefPlan.resolved} ambiguous=${costCodeRefPlan.ambiguous} unmatched=${costCodeRefPlan.unmatched} skippedNoItem=${costCodeRefPlan.skippedNoItem} skippedNoIndent=${costCodeRefPlan.skippedNoIndent}`,
    );

    const rmCodeSummary =
      rmCodePlan.updates.length === 0
        ? "No SLV / SLV METAL / TPAV+SLV / NRV indent rows to link."
        : `${rmCodePlan.resolved} linked, ${rmCodePlan.ambiguous} with multiple RM codes, ${rmCodePlan.unmatched} with no RM code.`;

    const costCodeRefSummary =
      costCodeRefPlan.resolved === 0 &&
      costCodeRefPlan.ambiguous === 0 &&
      costCodeRefPlan.unmatched === 0
        ? "No cost code ref to publish."
        : `Cost code ref: ${costCodeRefPlan.resolved} filled, ${costCodeRefPlan.ambiguous} with multiple RM codes, ${costCodeRefPlan.unmatched} with no RM code, ${costCodeRefPlan.skippedNoIndent} with no matching indent row.`;

    const reason = recomputeSkipped
      ? `V1-V4 recompute skipped: every row is already collapsed to its base item, so the variant split can no longer be rebuilt. Sync from Contract Review first. ${rmCodeSummary} ${costCodeRefSummary}`
      : updated === 0 && deleted === 0
        ? `All indent rows already have the correct base item and V1-V4 values. ${rmCodeSummary} ${costCodeRefSummary}`
        : undefined;

    return {
      success: true,
      data: {
        updated,
        deleted,
        total: rows.length,
        recomputeSkipped,
        rmCode: {
          rows: rmCodePlan.updates.length,
          written: rmCodeWrites.length,
          resolved: rmCodePlan.resolved,
          ambiguous: rmCodePlan.ambiguous,
          unmatched: rmCodePlan.unmatched,
        },
        costCodeRef: {
          rows: contractCostRefRows.length,
          written: costCodeRefUpdates.length,
          resolved: costCodeRefPlan.resolved,
          ambiguous: costCodeRefPlan.ambiguous,
          unmatched: costCodeRefPlan.unmatched,
          skippedNoItem: costCodeRefPlan.skippedNoItem,
          skippedNoIndent: costCodeRefPlan.skippedNoIndent,
        },
        reason,
      },
    };
  } catch (error: any) {
    console.error("Error recomputing IndentListing versions:", error);
    return {
      success: false,
      error: error.message || "Failed to recompute IndentListing versions.",
    };
  }
}

// /bom edits land on the normalized BOM tables. Row ids come from GET /api/bom:
// a plain id is a BomItem, `bom:<id>` a component-less Bom, `item:<id>` a
// BOM-less FullItem.
const BOM_LEVEL_FIELDS = new Set(["bomIdType"]);
const BOM_ITEM_LEVEL_FIELDS = new Set(["bomItemQty"]);
const FULL_ITEM_LEVEL_FIELDS = new Set([
  "itemScheduleName",
  "itemType",
  "moc",
  "operation",
  "size",
  "no",
  "pnGmd",
  "currentReqt",
  "merged",
  "duplicateMergerCount",
  "bomNature",
  "consumption1",
  "consumption2",
  "consumption3",
]);

export async function updateVerifyBomFieldBatchAction(
  ids: string[],
  field: string,
  value: string | null,
) {
  "use server";
  await requireAccess();
  try {
    const isBom = BOM_LEVEL_FIELDS.has(field);
    const isBomItem = BOM_ITEM_LEVEL_FIELDS.has(field);
    const isFullItem = FULL_ITEM_LEVEL_FIELDS.has(field);
    if (!isBom && !isBomItem && !isFullItem) {
      return { success: false, error: `Field "${field}" is not editable.` };
    }
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      return { success: true, count: 0 };
    }

    const bomItemIds: string[] = [];
    const bomIds = new Set<string>();
    const fullItemIds = new Set<string>();
    for (const id of unique) {
      if (id.startsWith("bom:")) bomIds.add(id.slice(4));
      else if (id.startsWith("item:")) fullItemIds.add(id.slice(5));
      else bomItemIds.push(id);
    }
    const components = await prisma.bomItem.findMany({
      where: { id: { in: bomItemIds } },
      select: { id: true, bomId: true, bom: { select: { fullItemId: true } } },
    });
    for (const c of components) {
      bomIds.add(c.bomId);
      fullItemIds.add(c.bom.fullItemId);
    }
    if (isFullItem && bomIds.size > 0) {
      const boms = await prisma.bom.findMany({
        where: { id: { in: [...bomIds] } },
        select: { fullItemId: true },
      });
      for (const b of boms) fullItemIds.add(b.fullItemId);
    }

    if (isBomItem) {
      const raw = (value ?? "").trim();
      if (raw && !/^\d+$/.test(raw)) {
        return { success: false, error: "BOM ITEM QTY must be a whole number." };
      }
      if (components.length === 0) {
        return { success: false, error: "BOM ITEM QTY can only be set on a component row." };
      }
      const res = await prisma.bomItem.updateMany({
        where: { id: { in: components.map((c) => c.id) } },
        data: { quantity: raw ? parseInt(raw, 10) : null },
      });
      return { success: true, count: res.count };
    }
    if (isBom) {
      const res = await prisma.bom.updateMany({
        where: { id: { in: [...bomIds] } },
        data: { bomIdType: value },
      });
      return { success: true, count: res.count };
    }
    const res = await prisma.fullItem.updateMany({
      where: { id: { in: [...fullItemIds] } },
      data: { [field]: value },
    });
    return { success: true, count: res.count };
  } catch (error: any) {
    console.error("Error updating BOM fields:", error);
    return {
      success: false,
      error: error.message || "Failed to update BOM fields.",
    };
  }
}

/**
 * Syncs available stock from Google Sheet (stock-phys tab ONLY)
 * ONLY for VerifyBom rows where availableStock is null, empty string, or whitespace.
 */
export async function syncNullVerifyBomStockAction() {
  "use server";
  await requireAccess();
  try {
    const { fetchStockPhysicalSheet } = await import(
      "@/lib/gmd_lib/google-sheets"
    );

    const stockPhysMap = await fetchStockPhysicalSheet();

    // Stock now lives on RawMaterial. Gap-fill only: rows whose erpItemCode has
    // no availableStock yet.
    const nullRows = await prisma.rawMaterial.findMany({
      where: {
        OR: [{ availableStock: null }, { availableStock: "" }],
      },
      select: { id: true, erpItemCode: true },
    });

    const updates: { id: string; stock: string }[] = [];
    const unmatchedSamples: string[] = [];
    let matchedByRmCode = 0;
    let unmatched = 0;

    for (const row of nullRows) {
      const code = (row.erpItemCode ?? "").trim().toUpperCase();
      if (!code) {
        unmatched++;
        continue;
      }

      const foundStock = stockPhysMap[code];

      // A sheet value of "0" is a real count and must be kept; only a blank
      // (or a code missing from the sheet) counts as no match.
      if (foundStock !== undefined && foundStock.trim() !== "") {
        updates.push({ id: row.id, stock: foundStock });
        matchedByRmCode++;
      } else {
        unmatched++;
        if (unmatchedSamples.length < 20) {
          unmatchedSamples.push(`RM: ${row.erpItemCode || "<empty>"}`);
        }
      }
    }

    if (updates.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.rawMaterial.update({
              where: { id: u.id },
              data: { availableStock: u.stock },
            }),
          ),
        );
      }
    }

    return {
      success: true,
      updatedCount: updates.length,
      totalNullCount: nullRows.length,
      matchedByRmCode,
      matchedByItemCode: 0,
      unmatched,
      unmatchedSamples,
    };
  } catch (error: any) {
    console.error("Error syncing null VerifyBom stock:", error);
    return {
      success: false,
      error: error.message || "Failed to sync available stock from sheet.",
    };
  }
}

const BATCH_NO_USE = "NO USE";
const BATCH_C = "C";

type BomMastSyncPlan = {
  phase1: {
    tabTitle: string;
    sheetRows: number;
    skippedNoKey: number;
    withToDate: number;
    withoutToDate: number;
    willMark: number;
    willAddBatch: number;
    alreadyCorrect: number;
    willCreate: number;
    staleNoUse: number;
    untouchedBlank: number;
    use: number;
    samples: {
      willAddBatch: string[];
      willCreate: string[];
      staleNoUse: string[];
      staleBatch: string[];
    };
  };
  phase2: {
    tabTitle: string;
    sheetCodes: number;
    duplicateCodes: number;
    scanned: number;
    itemNameChanged: number;
    rmItemNameChanged: number;
    unchanged: number;
    unmatched: number;
    samples: string[];
  };
};

/**
 * Builds the full write plan for the "ItemName (C)" button without touching the
 * database. Shared by the check and the apply paths so the numbers the user
 * reviews are produced by exactly the code that will run.
 *
 * Phase 1 - BOM MAST ERP (gid 1180547059), key bomId||itemCode||rmItemCode:
 *   any row with a TO_DATE is marked noUse="NO USE" + cBatch="C". Combos absent
 *   from VerifyBom are created with every other field null. Rows already
 *   NO USE but with no TO_DATE in the sheet are reported and left untouched.
 *
 * Phase 2 - ITEM MASTER ERP (gid 253020709), ITEM_CODE -> ITEM_NAME:
 *   every itemCode and rmItemCode in VerifyBom is looked up and the sheet name
 *   wins wherever it has a value. A null/empty sheet cell never replaces an
 *   existing name. Identical values are skipped so only real changes are written.
 */
type BomComponentRow = {
  id: string;
  bomId: string;
  itemCode: string;
  rmItemCode: string;
  noUse: string | null;
  cBatch: string | null;
  itemName: string | null;
  rmItemName: string | null;
};

// Flattens the relational BOM chain (FullItem -> Bom -> BomItem -> RawMaterial |
// FullItem) into the bomId||itemCode||rmItemCode shape the ERP syncs work with.
async function loadBomComponentRows(): Promise<BomComponentRow[]> {
  const components = await prisma.bomItem.findMany({
    select: {
      id: true,
      noUse: true,
      cBatch: true,
      bom: {
        select: {
          bomId: true,
          fullItem: { select: { itemCode: true, itemName: true } },
        },
      },
      rawMaterial: { select: { erpItemCode: true, itemNameAuto: true } },
      fullItem: { select: { itemCode: true, itemName: true } },
    },
  });
  return components.map((c) => ({
    id: c.id,
    bomId: c.bom?.bomId ?? "",
    itemCode: c.bom?.fullItem?.itemCode ?? "",
    rmItemCode: c.rawMaterial?.erpItemCode ?? c.fullItem?.itemCode ?? "",
    noUse: c.noUse,
    cBatch: c.cBatch,
    itemName: c.bom?.fullItem?.itemName ?? null,
    rmItemName: c.rawMaterial?.itemNameAuto ?? c.fullItem?.itemName ?? null,
  }));
}

async function resolveBomItemTarget(
  bomId: string,
  itemCode: string,
  rmItemCode: string,
): Promise<{
  bomDbId: string;
  rawMaterialId: string | null;
  fullItemId: string | null;
} | null> {
  const bom = await prisma.bom.findFirst({
    where: { bomId, fullItem: { itemCode } },
    select: { id: true },
  });
  if (!bom) return null;

  const rm = await prisma.rawMaterial.findFirst({
    where: { erpItemCode: rmItemCode },
    select: { id: true },
  });
  if (rm) return { bomDbId: bom.id, rawMaterialId: rm.id, fullItemId: null };

  const fi = await prisma.fullItem.findFirst({
    where: { itemCode: rmItemCode },
    select: { id: true },
  });
  if (fi) return { bomDbId: bom.id, rawMaterialId: null, fullItemId: fi.id };

  return null;
}

async function buildBomMastSyncPlan(): Promise<BomMastSyncPlan> {
  const { readBomMastErp, readItemMasterErp } = await import(
    "@/lib/gmd_lib/bomMastErp"
  );

  const keyOf = (bomId: string, itemCode: string, rmItemCode: string) =>
    `${bomId}||${itemCode}||${rmItemCode}`;
  const norm = (v: string | null) => (v ?? "").trim().toUpperCase();
  const sample = (arr: string[], v: string, cap = 10) => {
    if (arr.length < cap) arr.push(v);
  };

  // ---------------- Phase 1: BOM MAST ERP ----------------
  const bomMast = await readBomMastErp();

  const toDateKeys = new Set<string>();
  for (const r of bomMast.rows) {
    if (!r.toDate) continue;
    toDateKeys.add(
      keyOf(
        r.bomId.trim().toUpperCase(),
        r.itemCode.trim().toUpperCase(),
        r.rmItemCode.trim().toUpperCase(),
      ),
    );
  }

  const dbRows = await loadBomComponentRows();

  const byKey = new Map<string, BomComponentRow>();
  for (const r of dbRows) {
    byKey.set(keyOf(norm(r.bomId), norm(r.itemCode), norm(r.rmItemCode)), r);
  }

  const p1 = {
    tabTitle: bomMast.tabTitle,
    sheetRows: bomMast.rows.length,
    skippedNoKey: bomMast.skipped,
    withToDate: toDateKeys.size,
    withoutToDate: bomMast.rows.length - toDateKeys.size,
    willMark: 0,
    willAddBatch: 0,
    alreadyCorrect: 0,
    willCreate: 0,
    staleNoUse: 0,
    untouchedBlank: 0,
    use: 0,
    samples: {
      willAddBatch: [] as string[],
      willCreate: [] as string[],
      staleNoUse: [] as string[],
      staleBatch: [] as string[],
    },
  };

  for (const key of toDateKeys) {
    const existing = byKey.get(key);
    if (!existing) {
      p1.willCreate++;
      sample(p1.samples.willCreate, key);
      continue;
    }
    const isNoUse = (existing.noUse ?? "").trim() === BATCH_NO_USE;
    const isC = (existing.cBatch ?? "").trim() === BATCH_C;
    if (isNoUse && isC) p1.alreadyCorrect++;
    else if (isNoUse) {
      p1.willAddBatch++;
      sample(p1.samples.willAddBatch, key);
    } else {
      p1.willMark++;
    }
  }

  // DB rows the sheet no longer backs, plus the untouched buckets.
  for (const [key, row] of byKey) {
    const isNoUse = (row.noUse ?? "").trim() === BATCH_NO_USE;
    const isC = (row.cBatch ?? "").trim() === BATCH_C;
    if (isC && !isNoUse) {
      // invariant violation: a C without NO USE
      p1.samples.staleBatch.push(key);
    }
    if (isNoUse && !toDateKeys.has(key)) {
      p1.staleNoUse++;
      sample(p1.samples.staleNoUse, key);
      continue;
    }
    if (!isNoUse && !toDateKeys.has(key)) {
      if ((row.noUse ?? "").trim().toUpperCase() === "USE") p1.use++;
      else p1.untouchedBlank++;
    }
  }

  // ---------------- Phase 2: ITEM MASTER ERP ----------------
  const itemMaster = await readItemMasterErp();
  const { nameByCode } = itemMaster;

  const p2 = {
    tabTitle: itemMaster.tabTitle,
    sheetCodes: nameByCode.size,
    duplicateCodes: itemMaster.duplicateCodes,
    scanned: dbRows.length,
    itemNameChanged: 0,
    rmItemNameChanged: 0,
    unchanged: 0,
    unmatched: 0,
    samples: [] as string[],
  };

  for (const row of dbRows) {
    const itemSheet = nameByCode.get(norm(row.itemCode));
    const rmSheet = nameByCode.get(norm(row.rmItemCode));
    if (itemSheet !== undefined) {
      if (itemSheet !== (row.itemName ?? "")) p2.itemNameChanged++;
      else p2.unchanged++;
    } else {
      p2.unmatched++;
      sample(p2.samples, `itemCode: ${row.itemCode || "<empty>"}`);
    }
    if (rmSheet !== undefined && rmSheet !== (row.rmItemName ?? "")) {
      p2.rmItemNameChanged++;
    }
  }

  return { phase1: p1, phase2: p2 };
}

/** Read-only preview behind the confirm dialog. Performs no writes. */
export async function checkBomMastSyncAction() {
  "use server";
  await requireAccess();
  try {
    return { success: true, plan: await buildBomMastSyncPlan() };
  } catch (error: any) {
    console.error("Error checking BOM MAST ERP / ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to check sheets.",
    };
  }
}

/**
 * Applies the "ItemName (C)" button: Phase 1 (TO_DATE -> NO USE + batch C,
 * creating missing combinations) then Phase 2 (ITEM MASTER ERP names).
 *
 * Phase 1 is one-way: nothing in this codebase can set noUse back to "USE".
 */
export async function syncBomMastItemNamesAction() {
  "use server";
  await requireAccess();
  try {
    const plan = await buildBomMastSyncPlan();
    const { readBomMastErp, readItemMasterErp } = await import(
      "@/lib/gmd_lib/bomMastErp"
    );

    const keyOf = (bomId: string, itemCode: string, rmItemCode: string) =>
      `${bomId}||${itemCode}||${rmItemCode}`;
    const norm = (v: string | null) => (v ?? "").trim().toUpperCase();
    const CHUNK = 100;

    // ---------------- Phase 1 ----------------
    const bomMast = await readBomMastErp();
    const toDateKeys = new Set<string>();
    for (const r of bomMast.rows) {
      if (!r.toDate) continue;
      toDateKeys.add(
        keyOf(
          r.bomId.trim().toUpperCase(),
          r.itemCode.trim().toUpperCase(),
          r.rmItemCode.trim().toUpperCase(),
        ),
      );
    }

    const dbRows = await loadBomComponentRows();
    const idByKey = new Map<string, string>();
    for (const r of dbRows) {
      idByKey.set(keyOf(norm(r.bomId), norm(r.itemCode), norm(r.rmItemCode)), r.id);
    }

    const updateOps: ReturnType<typeof prisma.bomItem.update>[] = [];
    let marked = 0;
    let created = 0;

    for (const key of toDateKeys) {
      const existingId = idByKey.get(key);
      if (existingId) {
        updateOps.push(
          prisma.bomItem.update({
            where: { id: existingId },
            // only the two flag fields - never clobber names/stock/cost
            data: { noUse: BATCH_NO_USE, cBatch: BATCH_C },
          }),
        );
        marked++;
        continue;
      }

      const [bomId, itemCode, rmItemCode] = key.split("||");
      const target = await resolveBomItemTarget(bomId, itemCode, rmItemCode);
      if (!target) continue;
      await prisma.bomItem.create({
        data: {
          bomId: target.bomDbId,
          rawMaterialId: target.rawMaterialId,
          fullItemId: target.fullItemId,
          noUse: BATCH_NO_USE,
          cBatch: BATCH_C,
        },
      });
      created++;
    }

    for (let i = 0; i < updateOps.length; i += CHUNK) {
      await prisma.$transaction(updateOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }

    // ---------------- Phase 2 ----------------
    const { nameByCode } = await readItemMasterErp();

    // Names live on FullItem (itemName) and RawMaterial (itemNameAuto). Only
    // codes referenced by a BOM component are considered.
    const itemCodes = [...new Set(dbRows.map((c) => c.itemCode).filter(Boolean))];
    const rmCodes = [...new Set(dbRows.map((c) => c.rmItemCode).filter(Boolean))];

    const fullItems = await prisma.fullItem.findMany({
      where: { itemCode: { in: itemCodes } },
      select: { id: true, itemCode: true, itemName: true },
    });
    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { erpItemCode: { in: rmCodes } },
      select: { id: true, erpItemCode: true, itemNameAuto: true },
    });

    const nameOps: ReturnType<typeof prisma.fullItem.update>[] = [];
    const rmNameOps: ReturnType<typeof prisma.rawMaterial.update>[] = [];
    const unmatchedCodes: string[] = [];
    let itemNameChanged = 0;
    let rmItemNameChanged = 0;

    // A null/empty sheet cell never replaces an existing name.
    for (const row of fullItems) {
      const itemSheet = nameByCode.get(norm(row.itemCode));
      if (itemSheet !== undefined && itemSheet !== (row.itemName ?? "")) {
        nameOps.push(
          prisma.fullItem.update({
            where: { id: row.id },
            data: { itemName: itemSheet },
          }),
        );
        itemNameChanged++;
      } else if (itemSheet === undefined && unmatchedCodes.length < 20) {
        unmatchedCodes.push(`itemCode: ${row.itemCode || "<empty>"}`);
      }
    }

    for (const row of rawMaterials) {
      const rmSheet = nameByCode.get(norm(row.erpItemCode));
      if (rmSheet !== undefined && rmSheet !== (row.itemNameAuto ?? "")) {
        rmNameOps.push(
          prisma.rawMaterial.update({
            where: { id: row.id },
            data: { itemNameAuto: rmSheet },
          }),
        );
        rmItemNameChanged++;
      } else if (rmSheet === undefined && unmatchedCodes.length < 20) {
        unmatchedCodes.push(`rmItemCode: ${row.erpItemCode || "<empty>"}`);
      }
    }

    for (let i = 0; i < nameOps.length; i += CHUNK) {
      await prisma.$transaction(nameOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }
    for (let i = 0; i < rmNameOps.length; i += CHUNK) {
      await prisma.$transaction(rmNameOps.slice(i, i + CHUNK), {
        timeout: 20000,
      });
    }

    if (unmatchedCodes.length > 0) {
      console.warn(
        `[ItemName (C)] ${unmatchedCodes.length} code(s) not present in ITEM MASTER ERP:\n` +
          unmatchedCodes.map((c) => `  ${c}`).join("\n"),
      );
    }

    return {
      success: true,
      plan,
      applied: {
        marked,
        created,
        itemNameChanged,
        rmItemNameChanged,
        unmatchedSamples: unmatchedCodes,
      },
    };
  } catch (error: any) {
    console.error("Error syncing BOM MAST ERP / ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to sync item names from sheets.",
    };
  }
}

const C_BATCH_CHUNK = 1000;

type CBatchTableResult = {
  table: string;
  fields: string;
  distinctCodes: number;
  matchedCodes: number;
  rowsToUpdate: number;
  alreadyMarked: number;
};

/**
 * Marks cBatch="C" on every row whose item code carries ITEM_STATUS = "C" in the
 * ITEM MASTER ERP tab (gid 253020709).
 *
 * SET-ONLY BY DESIGN: nothing is ever cleared. A code that flips C -> U in the
 * sheet, or disappears from it, keeps the mark it already has, so re-running is
 * idempotent and a mis-click cannot destroy data.
 *
 * VerifyBom is deliberately NOT written: /bom's cBatch comes from the BOM MAST
 * ERP TO_DATE flow, which is a different signal and is left alone.
 *
 * Prisma's per-model delegates have incompatible generic signatures, so the four
 * targets are handled with explicit calls rather than a table of delegates. The
 * pure matching logic is shared.
 */
export async function syncCBatchAction(dryRun = false) {
  "use server";
  await requireAccess();
  try {
    const { readItemMasterErp } = await import("@/lib/gmd_lib/bomMastErp");
    const { tabTitle, statusByCode } = await readItemMasterErp();

    const cCodes = new Set<string>();
    for (const [code, status] of statusByCode) {
      if (status === C_BATCH_VALUE) cCodes.add(code);
    }

    // Collect the codes a table actually holds, then keep only the C ones.
    const matchedFor = (values: (string | null)[]) => {
      const present = new Set<string>();
      for (const v of values) {
        const k = String(v ?? "").trim().toUpperCase();
        if (k) present.add(k);
      }
      return { present, matched: [...present].filter((c) => cCodes.has(c)) };
    };

    const perTable: CBatchTableResult[] = [];
    const push = (r: Omit<CBatchTableResult, "alreadyMarked">, total: number) =>
      perTable.push({ ...r, alreadyMarked: Math.max(0, total - r.rowsToUpdate) });

    // ---- GMDUpdateItem.erpItemCode ----
    {
      const rows = await prisma.rawMaterial.findMany({
        select: { erpItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.erpItemCode));
      const total = rows.filter(
        (r) => r.erpItemCode && matched.includes(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) =>
          r.erpItemCode &&
          !r.cBatch &&
          matched.includes(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await prisma.rawMaterial.updateMany({
            where: { erpItemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "RawMaterial",
          fields: "erpItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- ContractReview.itemCode ----
    {
      const rows = await tenderPrisma.contractReview.findMany({
        select: { itemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.itemCode));
      const set = new Set(matched);
      const total = rows.filter(
        (r) => r.itemCode && set.has(String(r.itemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) => r.itemCode && !r.cBatch && set.has(String(r.itemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await tenderPrisma.contractReview.updateMany({
            where: { itemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "ContractReview",
          fields: "itemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- SupplyHistoryItem.erpItemCode ----
    {
      const rows = await prisma.supplyHistoryItem.findMany({
        select: { erpItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor(rows.map((r) => r.erpItemCode));
      const set = new Set(matched);
      const total = rows.filter(
        (r) => r.erpItemCode && set.has(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      const pending = rows.filter(
        (r) => r.erpItemCode && !r.cBatch && set.has(String(r.erpItemCode).trim().toUpperCase()),
      ).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          await prisma.supplyHistoryItem.updateMany({
            where: { erpItemCode: { in: matched.slice(i, i + C_BATCH_CHUNK) } },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "SupplyHistoryItem",
          fields: "erpItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    // ---- EnquiryItem: erpItemCode OR rmItemCode marks the row ----
    {
      const rows = await prisma.enquiryItem.findMany({
        select: { erpItemCode: true, rmItemCode: true, cBatch: true },
      });
      const { present, matched } = matchedFor([
        ...rows.map((r) => r.erpItemCode),
        ...rows.map((r) => r.rmItemCode),
      ]);
      const set = new Set(matched);
      const isC = (r: { erpItemCode: string | null; rmItemCode: string | null }) =>
        (r.erpItemCode && set.has(String(r.erpItemCode).trim().toUpperCase())) ||
        (r.rmItemCode && set.has(String(r.rmItemCode).trim().toUpperCase()));
      const total = rows.filter(isC).length;
      const pending = rows.filter((r) => !r.cBatch && isC(r)).length;
      if (!dryRun && pending > 0) {
        for (let i = 0; i < matched.length; i += C_BATCH_CHUNK) {
          const slice = matched.slice(i, i + C_BATCH_CHUNK);
          await prisma.enquiryItem.updateMany({
            where: {
              OR: [{ erpItemCode: { in: slice } }, { rmItemCode: { in: slice } }],
            },
            data: { cBatch: C_BATCH_VALUE },
          });
        }
      }
      push(
        {
          table: "EnquiryItem",
          fields: "erpItemCode + rmItemCode",
          distinctCodes: present.size,
          matchedCodes: matched.length,
          rowsToUpdate: pending,
        },
        total,
      );
    }

    return {
      success: true,
      dryRun,
      tabTitle,
      sheetCodes: statusByCode.size,
      cCodes: cCodes.size,
      perTable,
    };
  } catch (error: any) {
    console.error("Error syncing cBatch from ITEM MASTER ERP:", error);
    return {
      success: false,
      error: error.message || "Failed to sync cBatch from the sheet.",
    };
  }
}
export async function syncContractReviewRmAvailAction() {
  "use server";
  await requireAccess();
  try {
    const {
      getBomRmAvailBatch,
      computeContractReviewRmAvail,
    } = await import("@/lib/verifyBomLookup");
    const { fetchStockPhysicalSheet } = await import(
      "@/lib/gmd_lib/google-sheets"
    );
    const { planContractPhysicalStock } = await import(
      "@/lib/contractPhysicalStock"
    );

    // 0. Refresh the Indent Listing V1..V4 split, the RM codes and the Contract
    //    Review COST CODE REF before the PHYSICAL STOCK step below reads that
    //    ref. Without this an NRV / SLV code published since the last Indent
    //    Listing recompute would be missed. The call is idempotent: the
    //    destructive collapse is skipped once the rows are already collapsed,
    //    but the RM code and cost code ref passes always run.
    const indentRecompute = await recomputeIndentListingVersionsAction();

    // 1. Blank-fill GMDUpdateItem.availableStock from the stock-phys sheet
    const stockPhysMap = await fetchStockPhysicalSheet();
    const stockPhysCodes = Object.keys(stockPhysMap);
    const blankStockRows = await prisma.rawMaterial.findMany({
      where: {
        OR: [{ availableStock: null }, { availableStock: "" }],
      },
      select: { id: true, erpItemCode: true, availableStock: true },
    });
    let stockFilled = 0;
    const stockUpdates: { id: string; stock: string }[] = [];
    for (const row of blankStockRows) {
      const code = (row.erpItemCode ?? "").trim().toUpperCase();
      if (!code) continue;
      const currentStock = (row.availableStock ?? "").trim();
      if (currentStock !== "") continue;
      const found = stockPhysMap[code];
      if (found !== undefined && found !== null) {
        const stock = String(found).trim();
        if (stock !== "") {
          stockUpdates.push({ id: row.id, stock });
        }
      }
    }
    if (stockUpdates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < stockUpdates.length; i += chunkSize) {
        const chunk = stockUpdates.slice(i, i + chunkSize);
        await prisma.$transaction(
          chunk.map((u) =>
            prisma.rawMaterial.update({
              where: { id: u.id },
              data: { availableStock: u.stock },
            }),
          ),
        );
      }
      stockFilled = stockUpdates.length;
    }

    // 2. Recompute RM AVAIL for all Contract Review rows with a bomId
    const withBom = await tenderPrisma.contractReview.findMany({
      where: { bomId: { not: null } },
      select: { id: true, bomId: true, orderQty: true, noUse: true },
    });
    const bomIds = [
      ...new Set(
        withBom.map((i) => i.bomId).filter((b): b is string => !!b),
      ),
    ];
    const bomAvail = await getBomRmAvailBatch(bomIds);
    const availMap = computeContractReviewRmAvail(
      withBom.map((i) => ({ id: i.id, bomId: i.bomId, orderQty: i.orderQty })),
      bomAvail,
    );
    const rmAvailUpdates = withBom
      .filter((i) => (availMap.get(i.id) ?? null) !== i.noUse)
      .map((i) =>
        tenderPrisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (rmAvailUpdates.length > 0) {
      await tenderPrisma.$transaction(rmAvailUpdates, { timeout: 30_000 });
    }

    // 3. Push the PHYSICAL STOCK column: match each row's RM code (costCodeRef)
    //    against the stock-phys sheet, summing every code in a comma-joined ref.
    const physicalRows = await tenderPrisma.contractReview.findMany({
      select: { id: true, costCodeRef: true, rmPhysicalStock: true },
    });
    const physicalMap = planContractPhysicalStock(physicalRows, stockPhysMap);
    const physicalUpdates = physicalRows.filter(
      (row) => (physicalMap.get(row.id) ?? null) !== row.rmPhysicalStock,
    );
    if (physicalUpdates.length > 0) {
      const chunkSize = 200;
      for (let i = 0; i < physicalUpdates.length; i += chunkSize) {
        const chunk = physicalUpdates.slice(i, i + chunkSize);
        await tenderPrisma.$transaction(
          chunk.map((row) =>
            tenderPrisma.contractReview.update({
              where: { id: row.id },
              data: { rmPhysicalStock: physicalMap.get(row.id) ?? null },
            }),
          ),
          { timeout: 30_000 },
        );
      }
    }

    return {
      success: true,
      data: {
        stockFilled,
        stockPhysCodes: stockPhysCodes.length,
        rmAvailUpdated: rmAvailUpdates.length,
        physicalStockUpdated: physicalUpdates.length,
        indentRecompute: indentRecompute?.data ?? null,
      },
    };
  } catch (error: any) {
    console.error("Error syncing ContractReview RM AVAIL:", error);
    return {
      success: false,
      error: error.message || "Failed to sync RM AVAIL.",
    };
  }
}
