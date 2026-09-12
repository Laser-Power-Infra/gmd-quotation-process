"use server";

import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";
import { recalculateItem, recalculateEnquiryItems, serializeItem, serializeEnquiry, autoDetectItemType, autoDetectMoc, getItemNameMerge } from "@/lib/costCalculator";
import { resolveItemCategory } from "@/lib/itemCategoryResolver";
import { extractSizeFromItemName } from "@/lib/sizeExtractor";
import { roundUp } from "@/lib/rounding";
import { validateVaPercent, getDefaultVaPercent } from "@/lib/vaValidation";
import { lookupAndSetItemCode, recomputeItemCodeForValues, fetchBomIdSet } from "@/lib/gmdItemCodeLookup";
import { fetchBomRows, buildRmCostMap, DIRECT_M2M, getBomEntry, getCachedBomRows } from "@/lib/gmdBomCostLookup";
import { update2to1CostForItems, buildRawMaterialsCostMap } from "@/lib/gmd2to1CostLookup";
import { getDistinctBomIds, getBatchDistinctBomIds, getBomRmAvailBatch, resolveContractReviewBomIdsFromActuator, computeContractReviewRmAvail, getFallbackBomRowByCostRef, getFallbackRowsByCostRefs } from "@/lib/verifyBomLookup";
import { getUsdInrRate } from "@/lib/gmd_lib/exchangeRate";
import { getRmStockMap, syncDirectM2MAvailableStock } from "@/lib/directM2MStockLookup";

// Create a new enquiry with initial items and multiple attachments
export async function createNewEnquiryAction(formData: {
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  enquiryType?: string | null;
  state?: string | null;
  paymentTerms?: string | null;
  inspection?: string | null;
  pbg?: string | null;
  utility?: string | null;
  orderStatus?: string | null;
  attachments: { name: string; size: number; type: string; content?: string }[];
  items: {
    itemName: string;
    quantity: number;
    itemType?: string | null;
    moc?: string | null;
    size?: string | null;
    pnRating?: string | null;
    operationType?: string | null;
    extension?: string | null;
    bypass?: string | null;
    others?: string[] | null;
    productCost?: number | null;
    costRefCode?: string | null;
    cost?: number | null;
    stockStatus?: string | null;
    stockQuantity?: string | null;
    availableStock?: string | null;
    stockAgainstContract?: string | null;
    discount?: number | null;
    vaPercent?: number | null;
  }[];
}) {
  try {
    const cleanDocket = formData.docketNumber.replace(/#/g, "").trim();
    // Check if docketNumber already exists
    const existing = await prisma.enquiry.findUnique({
      where: { docketNumber: cleanDocket },
    });

    if (existing) {
      return { success: false, error: "Docket Number already exists." };
    }

    console.log(`[Server] createEnquiry docket="${cleanDocket}" party="${formData.partyName}" items=${formData.items.length}`);
    for (const it of formData.items) {
      console.log(`  item: "${it.itemName}" qty=${it.quantity} type=${it.itemType || "?"} moc=${it.moc || "?"} size=${it.size || "?"}`);
    }

    // Upload files to Google Drive if content is present
    const attachmentCreates = await Promise.all(
      formData.attachments.map(async (att) => {
        if (att.content) {
          const res = await uploadFileToDrive(att.name, att.type, att.content);
          return {
            name: att.name,
            url: res.url,
            type: att.type,
            size: att.size,
          };
        } else {
          return {
            name: att.name,
            url: `/files/${att.name}`,
            type: att.type,
            size: att.size,
          };
        }
      })
    );

    const resolvedItems = await Promise.all(
      formData.items.map(async (item) => {
        const resolved = await resolveItemCategory({
          itemName: item.itemName,
          sheetItemType: item.itemType,
          sheetMoc: item.moc,
          sheetSize: item.size,
          sheetPnRating: (item as any).pnRating,
        });
        return {
          ...item,
          resolved,
          erpItemCode: null,
        };
      })
    );

    const created = await prisma.enquiry.create({
      data: {
        docketNumber: cleanDocket,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        enquiryType: formData.enquiryType || null,
        state: formData.state || null,
        paymentTerms: formData.paymentTerms || null,
        inspection: formData.inspection || null,
        pbg: formData.pbg || null,
        utility: formData.utility || null,
        orderStatus: formData.orderStatus || null,
        attachments: {
          create: attachmentCreates,
        },
        items: {
          create: resolvedItems.map((item, index) => {
            const itemCost = item.cost || null;
            let itemVa = item.vaPercent || null;
            if (itemVa === null) {
              const defaultVa = getDefaultVaPercent(item.resolved.itemType, item.resolved.size);
              if (defaultVa !== null) {
                itemVa = defaultVa;
              }
            }
            let itemQR: string | null = null;
            if (itemCost !== null && itemCost > 0 && itemVa !== null) {
              itemQR = roundUp(itemCost * (1 + (itemVa / 100))).toFixed(2);
            }
            return {
              position: index,
              itemName: item.itemName,
              quantity: item.quantity,
              itemType: item.resolved.itemType,
              moc: item.resolved.moc,
              itemTypeSource: item.resolved.itemTypeSource,
              mocSource: item.resolved.mocSource,
              size: item.resolved.size,
              pnRating: item.resolved.pnRating || null,
              operationType: item.operationType || null,
              extension: item.extension || null,
              bypass: item.bypass || null,
              others: Array.isArray((item as any).others) ? (item as any).others : ((item as any).others ? [String((item as any).others)] : []),
              productCost: item.productCost || null,
              costRefCode: item.costRefCode || null,
              cost: itemCost,
              stockStatus: item.stockStatus || null,
              stockQuantity: (item as any).stockQuantity || null,
              availableStock: (item as any).availableStock || null,
              stockAgainstContract: (item as any).stockAgainstContract || null,
              discount: item.discount || null,
              vaPercent: itemVa !== null ? String(itemVa) : null,
              quotedRate: itemQR,
              erpItemCode: null,
            };
          }),
        },
      },
      include: {
        items: true,
        attachments: true,
      },
    });

    // Run recalculation on each item to set the correct Cost based on lookup tables
    for (const item of created.items) {
      await recalculateItem(item.id);
    }

    // Refetch the fully updated enquiry with calculated costs
    const finalEnquiry = await prisma.enquiry.findUnique({
      where: { id: created.id },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    const serialized = serializeEnquiry(finalEnquiry);
    return { success: true, data: serialized };
  } catch (error: any) {
    console.error("Error creating enquiry:", error);
    return { success: false, error: error.message || "Failed to create enquiry." };
  }
}

// Add items to an existing enquiry/docket
export async function addItemsAction(formData: {
  enquiryId: string;
  items: {
    itemName: string;
    quantity: number;
    itemType?: string;
    moc?: string;
    size?: string;
    pnRating?: string;
    operationType?: string;
    extension?: string;
    bypass?: string;
    others?: string[] | null;
    productCost?: number;
    costRefCode?: string;
    cost?: number;
    stockStatus?: string;
    stockQuantity?: string;
    availableStock?: string;
    stockAgainstContract?: string;
    discount?: number;
    vaPercent?: number;
  }[];
}) {
  try {
    console.log(`[Server] addItems enquiry=${formData.enquiryId} items=${formData.items.length}`);
    for (const it of formData.items) {
      console.log(`  item: "${it.itemName}" qty=${it.quantity} type=${it.itemType || "?"} moc=${it.moc || "?"} size=${it.size || "?"}`);
    }

    const resolvedItems = await Promise.all(
      formData.items.map(async (item) => {
        const resolved = await resolveItemCategory({
          itemName: item.itemName,
          sheetItemType: item.itemType,
          sheetMoc: item.moc,
          sheetSize: item.size,
          sheetPnRating: (item as any).pnRating,
        });
        return {
          ...item,
          resolved,
          erpItemCode: null,
        };
      })
    );

    const maxPosItem = await prisma.enquiryItem.findFirst({
      where: { enquiryId: formData.enquiryId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const startPos = (maxPosItem?.position ?? -1) + 1;

    await prisma.enquiryItem.createMany({
      data: resolvedItems.map((item, index) => {
        const itemCost = item.cost || null;
        let itemVa = item.vaPercent || null;
        if (itemVa === null) {
          const defaultVa = getDefaultVaPercent(item.resolved.itemType, item.resolved.size);
          if (defaultVa !== null) {
            itemVa = defaultVa;
          }
        }
        let itemQR: string | null = null;
        if (itemCost !== null && itemCost > 0 && itemVa !== null) {
          itemQR = roundUp(itemCost * (1 + (itemVa / 100))).toFixed(2);
        }
        return {
          position: startPos + index,
          enquiryId: formData.enquiryId,
          itemName: item.itemName,
          quantity: item.quantity,
          itemType: item.resolved.itemType,
          moc: item.resolved.moc,
          itemTypeSource: item.resolved.itemTypeSource,
          mocSource: item.resolved.mocSource,
          size: item.resolved.size,
          pnRating: item.pnRating || null,
          operationType: item.operationType || null,
          extension: item.extension || null,
          bypass: item.bypass || null,
          others: Array.isArray((item as any).others) ? (item as any).others : ((item as any).others ? [String((item as any).others)] : []),
          productCost: item.productCost || null,
          costRefCode: item.costRefCode || null,
          cost: itemCost,
          stockStatus: item.stockStatus || null,
          stockQuantity: (item as any).stockQuantity || null,
          availableStock: (item as any).availableStock || null,
          stockAgainstContract: (item as any).stockAgainstContract || null,
          discount: item.discount || null,
          vaPercent: itemVa !== null ? String(itemVa) : null,
          quotedRate: itemQR,
          erpItemCode: null,
        };
      }),
    });

    // Run recalculation on all items of this enquiry to set correct costs
    const items = await prisma.enquiryItem.findMany({
      where: { enquiryId: formData.enquiryId },
    });
    for (const item of items) {
      await recalculateItem(item.id);
    }

    const createdItems = await prisma.enquiryItem.findMany({
      where: { enquiryId: formData.enquiryId },
      orderBy: { position: "asc" },
    });

    return { success: true, data: { enquiryId: formData.enquiryId, items: createdItems.map(serializeItem) } };
  } catch (error: any) {
    console.error("Error adding items:", error);
    return { success: false, error: error.message || "Failed to add items." };
  }
}

// Update a specific item and/or its parent enquiry fields and attachments
export async function updateEnquiryItemAction(formData: {
  itemId: string;
  itemName: string;
  quantity: number;
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  attachments?: { name: string; size: number; type: string; content?: string }[];
  itemType?: string;
  moc?: string;
  size?: string;
  pnRating?: string;
  operationType?: string;
  extension?: string;
  bypass?: string;
  others?: string[] | string;
  productCost?: number;
  costRefCode?: string;
  cost?: number;
  stockStatus?: string;
  stockQuantity?: string;
  availableStock?: string;
  stockAgainstContract?: string;
  discount?: number;
  enquiryType?: string;
  state?: string;
  paymentTerms?: string;
  inspection?: string;
  pbg?: string;
  utility?: string;
  vaPercent?: number;
  quotedRate?: string;
  orderStatus?: string;
}) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: formData.itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    console.log(`[Server] updateEnquiryItem item=${formData.itemId}`);
    const fieldDiffs: string[] = [];
    if (formData.itemName !== item.itemName) fieldDiffs.push(`itemName: "${item.itemName}" → "${formData.itemName}"`);
    if (formData.itemType !== undefined && formData.itemType !== item.itemType) fieldDiffs.push(`itemType: "${item.itemType}" → "${formData.itemType}"`);
    if (formData.moc !== undefined && formData.moc !== item.moc) fieldDiffs.push(`moc: "${item.moc}" → "${formData.moc}"`);
    if (formData.size !== undefined && formData.size !== item.size) fieldDiffs.push(`size: "${item.size}" → "${formData.size}"`);
    if (formData.operationType !== undefined && formData.operationType !== item.operationType) fieldDiffs.push(`opType: "${item.operationType}" → "${formData.operationType}"`);
    if (formData.extension !== undefined && formData.extension !== item.extension) fieldDiffs.push(`extension: "${item.extension}" → "${formData.extension}"`);
    if (formData.bypass !== undefined && formData.bypass !== item.bypass) fieldDiffs.push(`bypass: "${item.bypass}" → "${formData.bypass}"`);
    if (formData.quantity !== undefined && formData.quantity !== Number(item.quantity)) fieldDiffs.push(`qty: "${item.quantity}" → "${formData.quantity}"`);
    if (formData.cost !== undefined && formData.cost !== (item.cost ? Number(item.cost) : null)) fieldDiffs.push(`cost: "${item.cost}" → "${formData.cost}"`);
    if (fieldDiffs.length > 0) fieldDiffs.forEach(d => console.log(`  ${d}`));

    const cleanDocket = formData.docketNumber.replace(/#/g, "").trim();
    // Check if new docket number conflicts with another enquiry
    const conflictingEnquiry = await prisma.enquiry.findFirst({
      where: {
        docketNumber: cleanDocket,
        NOT: { id: item.enquiryId },
      },
    });

    if (conflictingEnquiry) {
      return { success: false, error: "Docket Number already exists on another enquiry." };
    }

    const updatedCost = formData.cost !== undefined ? formData.cost : (item.cost ? parseFloat(item.cost.toString()) : null);
    const updatedVa = formData.vaPercent !== undefined ? formData.vaPercent : (item.vaPercent ? parseFloat(item.vaPercent.toString()) : null);
    const updatedQty = formData.quantity !== undefined ? formData.quantity : (item.quantity ? parseFloat(item.quantity.toString()) : 0);

    let finalVa: number | null = updatedVa;
    let finalQuotedRate: string | null;
    let updatedItemWise: string | null = null;
    let updatedTotalVal: string | null = null;

    if (formData.quotedRate !== undefined) {
      // Reverse: QR explicitly provided — calculate VA% from QR/Cost
      const qrRaw = formData.quotedRate;
      finalQuotedRate = qrRaw === "" ? null : qrRaw;
      if (finalQuotedRate !== null && updatedCost !== null && updatedCost > 0) {
        const qrNum = parseFloat(finalQuotedRate);
        if (!isNaN(qrNum) && qrNum > 0) {
          finalVa = parseFloat(((qrNum / updatedCost - 1) * 100).toFixed(2));
          finalQuotedRate = roundUp(qrNum).toFixed(2);
        }
      }
    } else {
      // Forward: QR not provided — calculate from Cost+VA% if both exist
      if (updatedCost !== null && updatedCost > 0 && finalVa !== null) {
        const qr = updatedCost * (1 + (finalVa / 100));
        finalQuotedRate = roundUp(qr).toFixed(2);
      } else {
        finalQuotedRate = item.quotedRate || null;
      }
    }

    // Calculate QR incl. GST
    let finalQuotedRateGst: string | null = null;
    if (finalQuotedRate) {
      const qrFloat = parseFloat(finalQuotedRate);
      if (qrFloat > 0) {
        finalQuotedRateGst = (qrFloat * 1.18).toFixed(2);
      }
    }

    // Calculate totals if QR exists
    if (finalQuotedRate) {
      const qrFloat = parseFloat(finalQuotedRate);
      if (updatedQty > 0 && qrFloat > 0) {
        const itemWise = updatedQty * qrFloat;
        updatedItemWise = itemWise.toFixed(2);
        updatedTotalVal = (itemWise * 1.18).toFixed(2);
      }
    }

    const resolved = await resolveItemCategory({
      itemName: formData.itemName,
      sheetItemType: formData.itemType,
      sheetMoc: formData.moc,
      sheetSize: formData.size,
      sheetPnRating: formData.pnRating,
    });

    const finalOperationType = formData.operationType || null;
    // Recompute erpItemCode with BOM gate if any derived field changed
    const oldCodeForDialog = item.erpItemCode;
    let erpItemCode: string | null = oldCodeForDialog;
    const newDerivedForDialog = {
      itemType: resolved.itemType,
      moc: resolved.moc,
      size: resolved.size,
      pnRating: resolved.pnRating || formData.pnRating || null,
      operationType: finalOperationType,
    };
    const derivedChanged =
      newDerivedForDialog.itemType !== item.itemType ||
      newDerivedForDialog.moc !== item.moc ||
      newDerivedForDialog.size !== item.size ||
      newDerivedForDialog.pnRating !== (item.pnRating || null) ||
      newDerivedForDialog.operationType !== (item.operationType || null);
    if (derivedChanged) {
      try {
        const gated = await (await import("@/lib/gmdItemCodeLookup")).lookupItemCodeGated({
          itemType: newDerivedForDialog.itemType || "",
          moc: newDerivedForDialog.moc || "",
          operationType: newDerivedForDialog.operationType || "",
          size: newDerivedForDialog.size || "",
          pnRating: newDerivedForDialog.pnRating || "",
        });
        // Only use gated result if we have all fields; otherwise keep null (not populates)
        if (newDerivedForDialog.itemType && newDerivedForDialog.moc && newDerivedForDialog.size && newDerivedForDialog.pnRating && newDerivedForDialog.operationType) {
          erpItemCode = gated;
        } else {
          erpItemCode = null;
        }
      } catch (e) {
        console.warn("[updateEnquiryItemAction] gated lookup failed, keeping old code:", e);
      }
    }

    // If code changes and productCost is being set to null in this edit, we may still auto-fill later
    const productCostBeingEdited = formData.productCost || null;

    // Update item
    await prisma.enquiryItem.update({
      where: { id: formData.itemId },
      data: {
        itemName: formData.itemName,
        quantity: formData.quantity,
        itemType: resolved.itemType,
        moc: resolved.moc,
        itemTypeSource: resolved.itemTypeSource,
        mocSource: resolved.mocSource,
        size: resolved.size,
        pnRating: resolved.pnRating || formData.pnRating || null,
        operationType: finalOperationType,
        extension: formData.extension || null,
        bypass: formData.bypass || null,
        others: (()=>{ const v=(formData as any).others ?? (formData as any).other ?? null; if(Array.isArray(v)) return v; if(typeof v==="string" && v.trim()!=="") return [v.trim()]; if(v==null) return []; return []; })(),
        productCost: formData.productCost || null,
        costRefCode: formData.costRefCode || null,
        cost: formData.cost || null,
        stockStatus: formData.stockStatus || null,
        stockQuantity: (formData as any).stockQuantity || null,
        availableStock: (formData as any).availableStock || null,
        stockAgainstContract: (formData as any).stockAgainstContract || null,
        discount: formData.discount || null,
        vaPercent: finalVa !== null ? String(finalVa) : null,
        quotedRate: finalQuotedRate,
        quotedRateGst: finalQuotedRateGst,
        itemWiseTotalValue: updatedItemWise,
        totalValue: updatedTotalVal,
        erpItemCode,
      },
    });

    // Update attachments if provided and upload to Google Drive
    if (formData.attachments) {
      await prisma.attachment.deleteMany({
        where: { enquiryId: item.enquiryId },
      });

      const attachmentCreates = await Promise.all(
        formData.attachments.map(async (att) => {
          if (att.content) {
            const res = await uploadFileToDrive(att.name, att.type, att.content);
            return {
              enquiryId: item.enquiryId,
              name: att.name,
              url: res.url,
              type: att.type,
              size: att.size,
            };
          } else {
            return {
              enquiryId: item.enquiryId,
              name: att.name,
              url: `/files/${att.name}`,
              type: att.type,
              size: att.size,
            };
          }
        })
      );

      await prisma.attachment.createMany({
        data: attachmentCreates,
      });
    }

    // Update parent enquiry
    await prisma.enquiry.update({
      where: { id: item.enquiryId },
      data: {
        docketNumber: cleanDocket,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        enquiryType: formData.enquiryType || null,
        state: formData.state || null,
        paymentTerms: formData.paymentTerms || null,
        inspection: formData.inspection || null,
        pbg: formData.pbg || null,
        utility: formData.utility || null,
        orderStatus: formData.orderStatus || null,
      },
    });

    // Sync availableBomIds for new code (always) and auto-fill productCost if blank & single BOM
    const codeChangedInDialog = erpItemCode !== oldCodeForDialog;
    if (codeChangedInDialog) {
      try {
        await syncAvailableBomIds(formData.itemId, erpItemCode);
        if (erpItemCode) {
          const cur = await prisma.enquiryItem.findUnique({ where: { id: formData.itemId }, select: { productCost: true } });
          if (cur && cur.productCost === null) {
            await maybeUpdateProductCostFromNewCode(formData.itemId, erpItemCode, cur.productCost);
          }
        }
      } catch (e) {
        console.warn("[updateEnquiryItemAction] auto productCost cascade failed:", e);
      }
    }

    const updatedEnquiry = await prisma.enquiry.findUnique({
      where: { id: item.enquiryId },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    return {
      success: true,
      data: {
        item: serializeItem(await prisma.enquiryItem.findUnique({ where: { id: formData.itemId } })),
        enquiry: serializeEnquiry(updatedEnquiry),
      },
    };
  } catch (error: any) {
    console.error("Error updating enquiry item:", error);
    return { success: false, error: error.message || "Failed to update item." };
  }
}

// Append extra attachments to an existing enquiry without touching existing ones
export async function addAttachmentsAction(formData: {
  enquiryId: string;
  attachments: { name: string; size: number; type: string; content?: string }[];
}) {
  try {
    if (formData.attachments.length === 0) {
      return { success: false, error: "No files selected." };
    }

    const attachmentCreates = await Promise.all(
      formData.attachments.map(async (att) => {
        if (att.content) {
          const res = await uploadFileToDrive(att.name, att.type, att.content);
          return {
            enquiryId: formData.enquiryId,
            name: att.name,
            url: res.url,
            type: att.type,
            size: att.size,
          };
        } else {
          return {
            enquiryId: formData.enquiryId,
            name: att.name,
            url: `/files/${att.name}`,
            type: att.type,
            size: att.size,
          };
        }
      })
    );

    await prisma.attachment.createMany({
      data: attachmentCreates,
    });

    const updatedEnquiry = await prisma.enquiry.findUnique({
      where: { id: formData.enquiryId },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });

    return { success: true, data: serializeEnquiry(updatedEnquiry) };
  } catch (error) {
    console.error("Error adding attachments:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to add attachments." };
  }
}

// Update the orderStatus of an enquiry directly
export async function updateEnquiryOrderStatusAction(enquiryId: string, orderStatus: string) {
  try {
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { orderStatus },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message || "Failed to update order status." };
  }
}

// Delete an item. Enquiry is retained even if it becomes empty.
export async function deleteEnquiryItemAction(itemId: string) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    console.log(`[Server] deleteItem item="${item.id}" name="${item.itemName}" enquiry=${item.enquiryId}`);

    // Delete item - enquiry is kept even when no items remain
    await prisma.enquiryItem.delete({
      where: { id: itemId },
    });

    const enquiryDeleted = false;

    return { success: true, data: { itemId, enquiryId: item.enquiryId, enquiryDeleted } };
  } catch (error: any) {
    console.error("Error deleting item:", error);
    return { success: false, error: error.message || "Failed to delete item." };
  }
}

// Bulk delete multiple items from a single enquiry. Enquiry is retained even if all items are deleted.
// Single-enquiry constraint is enforced on server.
export async function deleteEnquiryItemsAction(itemIds: string[]) {
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }

    const uniqueIds = [...new Set(itemIds)];

    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, enquiryId: true, itemName: true },
    });

    if (items.length === 0) {
      return { success: false, error: "Items not found." };
    }
    if (items.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    const enquiryIds = [...new Set(items.map((i) => i.enquiryId))];
    if (enquiryIds.length !== 1) {
      return { success: false, error: "Bulk delete is allowed for a single enquiry only. Select items from one docket at a time." };
    }
    const enquiryId = enquiryIds[0];

    console.log(`[Server] bulkDelete enquiry=${enquiryId} requested=${uniqueIds.length}`);

    await prisma.enquiryItem.deleteMany({
      where: { id: { in: uniqueIds }, enquiryId },
    });

    const remaining = await prisma.enquiryItem.count({
      where: { enquiryId },
    });

    const enquiryDeleted = false;

    return { success: true, data: { deletedIds: uniqueIds, enquiryId, enquiryDeleted, remaining } };
  } catch (error: any) {
    console.error("Error bulk deleting items:", error);
    return { success: false, error: error.message || "Failed to delete items." };
  }
}

// Update a specific field of an enquiry directly (for inline cell editing)
export async function updateEnquiryFieldAction(
  enquiryId: string,
  field: string,
  value: any
) {
  try {
    // APM is gated to admin/developer only
    if (field === "apm") {
      const { auth } = await import("@/auth")
      const session = await auth()
      const role = (session?.user as any)?.role
      if (!session || !["admin", "developer"].includes(role)) {
        return { success: false, error: "Unauthorized: admin or developer only can set APM" }
      }
      if (value !== null && value !== "" && value !== "Yes" && value !== "No") {
        return { success: false, error: "APM must be Yes, No, or blank." }
      }
    }
    const prev = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { [field]: true },
    });
    const oldVal = prev ? (prev as any)[field] : undefined;
    console.log(`[Server] updateEnquiryField enquiry=${enquiryId} field=${field} old="${oldVal}" new="${value}"`);

    let parsedVal = value;
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { [field]: parsedVal },
    });

    // Recalculate costs of all items if an enquiry field affecting cost changed
    let updatedItems = null;
    if (["state", "paymentTerms", "inspection", "pbg"].includes(field)) {
      updatedItems = await recalculateEnquiryItems(enquiryId);
    }

    // Fetch the full enquiry with items to return
    const fullEnquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { items: { orderBy: { position: "asc" } } },
    });

    return {
      success: true,
      data: {
        enquiry: serializeEnquiry(fullEnquiry),
        items: updatedItems,
      },
    };
  } catch (error: any) {
    console.error(`Error updating enquiry ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${field}.` };
  }
}

// Update a specific field of an enquiry item directly (for inline cell editing)
export async function updateItemFieldAction(
  itemId: string,
  field: string,
  value: any
) {
  try {
    const prevFull = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
      select: {
        itemName: true,
        itemType: true,
        moc: true,
        size: true,
        pnRating: true,
        operationType: true,
        erpItemCode: true,
        productCost: true,
        [field]: true,
      },
    });
    const oldVal = prevFull ? (prevFull as any)[field] : undefined;
    const oldCode = prevFull?.erpItemCode ?? null;
    const oldProductCost = prevFull?.productCost ?? null;
    console.log(`[Server] updateItemField item=${itemId} field=${field} old="${oldVal}" new="${value}"`);

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
      parsedVal = parseFloat(String(value)) || 0;
    }

    let updatedItem;
    if (["productCost", "extension", "bypass", "quantity", "vaPercent", "quotedRate", "cost"].includes(field)) {
      const updates: any = {};
      if (field === "vaPercent") {
        updates.vaPercent = parsedVal !== null ? parseFloat(parsedVal) : null;
      } else if (field === "quotedRate") {
        updates.quotedRate = parsedVal !== null ? parseFloat(parsedVal) : null;
      } else {
        updates[field] = parsedVal;
      }
      updatedItem = await recalculateItem(itemId, updates);
    } else {
      const updateData: any = { [field]: parsedVal };
      if (field === "itemName") {
        const currentItem = await prisma.enquiryItem.findUnique({
          where: { id: itemId },
          select: { itemName: true, itemType: true, moc: true, itemTypeSource: true, mocSource: true, size: true, pnRating: true, bypass: true },
        });
        console.log(`[Server] itemName changed: "${currentItem?.itemName}" → "${parsedVal}"`);
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

      // If bypass changed via itemName gate, recalculate cost atomically
      if (updateData.bypass !== undefined) {
        const recalc = await recalculateItem(itemId, { bypass: updateData.bypass });
        if (recalc) {
          dbItem = await prisma.enquiryItem.findUnique({ where: { id: itemId } }) as any;
        }
      }

      const MERGE_FIELDS = ["itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass", "itemName"];
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
          // If code actually changed, sync availableBomIds (always) and maybe update productCost when null
          if (recomputed.changed) {
            const afterCode = await prisma.enquiryItem.findUnique({
              where: { id: itemId },
              select: { productCost: true, erpItemCode: true, availableBomIds: true },
            });
            // Sync availableBomIds even if productCost not null
            if (afterCode?.erpItemCode) {
              await syncAvailableBomIds(itemId, afterCode.erpItemCode);
            } else {
              await syncAvailableBomIds(itemId, null);
            }
            const refreshedAfterSync = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { productCost: true, erpItemCode: true } });
            if (refreshedAfterSync?.erpItemCode && refreshedAfterSync.productCost === null) {
              await maybeUpdateProductCostFromNewCode(itemId, refreshedAfterSync.erpItemCode, refreshedAfterSync.productCost);
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

    return { success: true, data: updatedItem };
  } catch (error: any) {
    console.error(`Error updating item ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${itemId}.` };
  }
}

// Helper: populate availableBomIds from VerifyBom for a given erpItemCode
async function syncAvailableBomIds(itemId: string, erpItemCode: string | null) {
  try {
    if (!erpItemCode) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: [] } });
      return [];
    }
    const ids = await getDistinctBomIds(erpItemCode);
    await prisma.enquiryItem.update({ where: { id: itemId }, data: { availableBomIds: ids } });
    return ids;
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
async function maybeUpdateProductCostFromNewCode(itemId: string, newCode: string | null, currentProductCost: any) {
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
      const vbRow = await prisma.verifyBom.findFirst({ where: { itemCode: newCode, bomId: candidateIds[0] }, select: { bomId: true, rmItemCode: true, bomIdType: true } });
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
    // Zero or single but VerifyBom miss → fallback to sheet DIRECT_M2M BOM
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
    // Primary has zero candidates (candidateIds==0 && sheet miss) -> costRefCode fallback (bomId stays NULL)
    // Fetch fresh bomId gate and costRefCode - only when bomId IS NULL, and fill only missing fields
    const fallbackMeta = preMeta; // reuse pre-fetched meta (already has bomId,costRefCode,productCost,availableStock,bomType)
    if (fallbackMeta?.bomId) return; // bomId already present, do not fallback
    const fallbackBomId = fallbackMeta?.costRefCode?.trim();
    if (!fallbackBomId) return;
    const vbFallback = await getFallbackBomRowByCostRef(fallbackBomId);
    if (!vbFallback?.rmItemCode) return;
    let fallbackCost: number | undefined;
    if (needProductCost) {
      const rawMap = await buildRawMaterialsCostMap([vbFallback.rmItemCode]);
      fallbackCost = rawMap.get(vbFallback.rmItemCode);
      if (fallbackCost === undefined) {
        const supplyMap = await buildRmCostMap([vbFallback.rmItemCode]);
        fallbackCost = supplyMap.get(vbFallback.rmItemCode);
      }
      if (fallbackCost !== undefined && fallbackCost !== null) {
        await recalculateItem(itemId, { productCost: fallbackCost });
      }
    }
    const fallbackBomType = vbFallback.bomIdType || DIRECT_M2M;
    const fallbackData: any = {}; // keep bomId null, rmItemCode null, availableBomIds [] per requirement
    if (needBomType && fallbackBomType) fallbackData.bomType = fallbackBomType;
    if (needStock && fallbackBomType === DIRECT_M2M) {
      const stockMap = await getRmStockMap([vbFallback.rmItemCode]);
      const stock = stockMap.get(vbFallback.rmItemCode);
      if (stock !== undefined && stock.trim() !== "") fallbackData.availableStock = stock;
    }
    if (Object.keys(fallbackData).length > 0) {
      await prisma.enquiryItem.update({ where: { id: itemId }, data: fallbackData });
    }
  } catch (e) {
    console.warn(`[maybeUpdateProductCost] failed for ${itemId} code=${newCode}:`, e);
  }
}

// User selects a single bomId from availableBomIds dropdown → persist to bomId/rmItemCode/bomType + optional cost
export async function selectBomIdAction(itemId: string, bomId: string | null) {
  try {
    const item = await prisma.enquiryItem.findUnique({ where: { id: itemId }, select: { erpItemCode: true, productCost: true, availableBomIds: true } });
    if (!item) return { success: false, error: "Item not found." };
    if (!item.erpItemCode) return { success: false, error: "Item has no Item Code." };
    if (bomId !== null && bomId !== "" && !item.availableBomIds.includes(bomId)) {
      return { success: false, error: "Selected BOM ID is not in available options." };
    }
    if (!bomId) {
      // Clear selection
      const cleared = await prisma.enquiryItem.update({ where: { id: itemId }, data: { bomId: null, rmItemCode: null, bomType: null } });
      return { success: true, data: serializeItem(cleared) };
    }
    const vbRow = await prisma.verifyBom.findFirst({ where: { itemCode: item.erpItemCode, bomId }, select: { bomId: true, rmItemCode: true, bomIdType: true } });
    if (!vbRow) return { success: false, error: "BOM not found for this item code." };
    // Update bom linkage and available stock if DIRECT M2M
    const bomType = vbRow.bomIdType || DIRECT_M2M;
    const dataToUpdate: any = { bomId: vbRow.bomId, bomType, rmItemCode: vbRow.rmItemCode };
    if (bomType === DIRECT_M2M && vbRow.rmItemCode) {
      const stockMap = await getRmStockMap([vbRow.rmItemCode]);
      const stock = stockMap.get(vbRow.rmItemCode);
      if (stock !== undefined) dataToUpdate.availableStock = stock;
    }
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: dataToUpdate,
    });
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

// Fetch/refresh ERP item codes for multiple enquiry items (triggered via UI button)
export async function fetchErpItemCodesAction(itemIds: string[]) {
  const updatedItems: ReturnType<typeof serializeItem>[] = [];
  let fetched = 0;
  let lastError: string | null = null;
  // Pre-warm BOM & BOM ID cache so gate checks don't fetch per item
  try {
    await Promise.all([getCachedBomRows(), fetchBomIdSet()]);
  } catch {}

  for (const itemId of itemIds) {
    try {
      const code = await lookupAndSetItemCode(itemId, { bomGate: true });
      let item = await prisma.enquiryItem.findUnique({
        where: { id: itemId },
      });
      if (item) {
        // Populate availableBomIds from VerifyBom for every code (even if productCost not null)
        if (item.erpItemCode) {
          try { await syncAvailableBomIds(itemId, item.erpItemCode); item = await prisma.enquiryItem.findUnique({ where: { id: itemId } }) as any; } catch {}
        }
        // Only count as fetched if item now has a code (gate passed)
        if (item!.erpItemCode) fetched++;
        // If we just fetched a new code and productCost is null, auto-fill cost (do not clear existing) - respects multi-BOM defer
        if (code && item!.productCost === null) {
          await maybeUpdateProductCostFromNewCode(itemId, item!.erpItemCode, item!.productCost);
          const refreshed = await prisma.enquiryItem.findUnique({ where: { id: itemId } });
          if (refreshed) {
            updatedItems.push(serializeItem(refreshed));
            continue;
          }
        }
        updatedItems.push(serializeItem(item!));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to fetch ERP item code.";
      lastError = message;
      console.error(`Error fetching ERP item code for item ${itemId}:`, error);
    }
  }

  if (fetched === 0) {
    return { success: false, error: lastError || "No item codes fetched." };
  }
  return { success: true, data: { items: updatedItems, fetched } };
}

// Fill blank productCost from raw material (BOM DIRECT M2M) costs, triggered via UI button
// PRIORITY: Raw Materials (GMDUpdateItem.cost) wins; SupplyHistory is fallback. Fixes FSD040002 -> RSD110023 (4900)
export async function updateProductCostFromBomAction(itemIds: string[]) {
  try {
    const bomRows = await fetchBomRows();
    const bomMap = new Map<string, { bomId: string | null; rmItemCode: string }>();
    for (const r of bomRows) {
      bomMap.set(r.itemCode, { bomId: r.bomId, rmItemCode: r.rmItemCode });
    }

    const rmCodes = [...new Set(bomRows.map((r) => r.rmItemCode))];
    // Raw Materials primary, SupplyHistory fallback (commented out primary supply path per requirement)
    const stockMap = await getRmStockMap(rmCodes);
    const rawCostMap = await buildRawMaterialsCostMap(rmCodes);
    let costMap = rawCostMap;
    const missing = rmCodes.filter((c) => !rawCostMap.has(c));
    if (missing.length > 0) {
      // Fallback: SupplyHistory legacy path — only for codes missing in Raw Materials
      const supplyMap = await buildRmCostMap(missing);
      for (const [k, v] of supplyMap) {
        if (!costMap.has(k)) costMap.set(k, v);
      }
    }

    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, erpItemCode: true, productCost: true, bomId: true, costRefCode: true, availableStock: true, bomType: true },
    });

    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;
    let lastError: string | null = null;
    const noCostRmCodes = new Set<string>();
    const noBomItemCodes = new Set<string>();
    // Collect items that missed primary sheet but may qualify for costRefCode fallback (zero candidates, bomId null)
    // Fallback should also fill availableStock/bomType even when productCost already present (per requirement: dont override present, fill missing)
    const fallbackCandidates: typeof items = [];

    for (const item of items) {
      if (!item.erpItemCode) continue;
      const needProductCost = item.productCost == null;
      const needStock = !item.availableStock || item.availableStock.trim() === "";
      const needBomType = !item.bomType;
      // If nothing needed, skip entirely
      if (!needProductCost && !needStock && !needBomType) continue;
      // Primary sheet path only when needProductCost (to avoid overriding); but still need to handle stock-only fallback later
      const bom = bomMap.get(item.erpItemCode);
      if (!bom) {
        // Check if qualifies for ephemeral costRefCode fallback (bomId null, costRefCode present)
        if (!item.bomId && item.costRefCode?.trim()) {
          fallbackCandidates.push(item);
        } else {
          // Only count as noBom if we actually needed something and couldn't fulfill
          if (needProductCost) noBomItemCodes.add(item.erpItemCode);
        }
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

    // Fallback pass: costRefCode as ephemeral bomId (bomId stays NULL, only bomType/availableStock/productCost)
    // Primary has zero candidates (bomMap miss) -> verify VerifyBom also has zero candidates
    // Non-override: only fill missing productCost/availableStock/bomType
    if (fallbackCandidates.length > 0) {
      const erpCodes = [...new Set(fallbackCandidates.map((i) => i.erpItemCode).filter(Boolean) as string[])];
      // Confirm VerifyBom also zero - if VerifyBom has candidates, do not fallback (respect zero-candidates gate)
      const vbDistinctMap = await getBatchDistinctBomIds(erpCodes);
      const trueFallback = fallbackCandidates.filter((it) => {
        const v = vbDistinctMap.get(it.erpItemCode!);
        return !v || v.length === 0;
      });
      if (trueFallback.length > 0) {
        const costRefCodes = [...new Set(trueFallback.map((i) => i.costRefCode!.trim()).filter(Boolean))];
        const fallbackMap = await getFallbackRowsByCostRefs(costRefCodes);
        // Collect rm codes from fallback rows for batch cost/stock fetch
        const fbRmCodes = [...new Set([...fallbackMap.values()].map((r) => r.rmItemCode).filter(Boolean) as string[])];
        const fbStockMap = await getRmStockMap(fbRmCodes);
        const fbRawMap = await buildRawMaterialsCostMap(fbRmCodes);
        const fbCostMap = new Map<string, number>(fbRawMap);
        const fbMissing = fbRmCodes.filter((c) => !fbRawMap.has(c));
        if (fbMissing.length > 0) {
          const fbSupply = await buildRmCostMap(fbMissing);
          for (const [k, v] of fbSupply) if (!fbCostMap.has(k)) fbCostMap.set(k, v);
        }
        for (const item of trueFallback) {
          const fbKey = item.costRefCode!.trim();
          const vbRow = fallbackMap.get(fbKey);
          if (!vbRow?.rmItemCode) {
            if (item.productCost == null) noBomItemCodes.add(item.erpItemCode!);
            continue;
          }
          const needProductCost = item.productCost == null;
          const needStock = !item.availableStock || item.availableStock.trim() === "";
          const needBomType = !item.bomType;
          if (!needProductCost && !needStock && !needBomType) continue;
          const cost = fbCostMap.get(vbRow.rmItemCode);
          try {
            let didCostUpdate = false;
            if (needProductCost && cost !== undefined && cost !== null) {
              await recalculateItem(item.id, { productCost: cost });
              didCostUpdate = true;
            } else if (needProductCost) {
              noCostRmCodes.add(vbRow.rmItemCode);
            }
            const bomType = (vbRow as any).bomIdType || DIRECT_M2M;
            const dataToUpdate: any = {}; // keep bomId null, rmItemCode null, availableBomIds [] per requirement
            if (needBomType && bomType) dataToUpdate.bomType = bomType;
            if (needStock) {
              const stock = fbStockMap.get(vbRow.rmItemCode);
              if (stock !== undefined && stock.trim() !== "") dataToUpdate.availableStock = stock;
            }
            if (Object.keys(dataToUpdate).length > 0) {
              await prisma.enquiryItem.update({ where: { id: item.id }, data: dataToUpdate });
            }
            const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
            if (refreshed) {
              updatedItems.push(serializeItem(refreshed));
              if (didCostUpdate) updated++;
              else if (needStock && dataToUpdate.availableStock !== undefined) updated++;
              else if (needBomType && dataToUpdate.bomType !== undefined) updated++;
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to update product cost (fallback).";
            lastError = message;
            console.error(`Error updating product cost (fallback) for item ${item.id}:`, error);
          }
        }
      } else {
        // Those not in trueFallback had VerifyBom candidates -> keep as noBom? they will be handled via maybeUpdate which defers; mark as noBom for message only if productCost needed
        for (const it of fallbackCandidates) {
          const v = vbDistinctMap.get(it.erpItemCode!);
          if (v && v.length > 0 && it.productCost == null) noBomItemCodes.add(it.erpItemCode!);
        }
      }
    }

    if (updated === 0) {
      const errMsgs: string[] = [];
      if (noCostRmCodes.size > 0) {
        errMsgs.push(`No cost found in Raw Materials or Supply History for RM Code(s): ${[...noCostRmCodes].join(", ")}.`);
      }
      if (noBomItemCodes.size > 0) {
        errMsgs.push(`No DIRECT M2M BOM recipe found for Item Code(s): ${[...noBomItemCodes].join(", ")}.`);
      }
      return { success: false, error: errMsgs.join(" ") || lastError || "No product costs updated." };
    }
    return { success: true, data: { items: updatedItems, updated } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update product cost.";
    return { success: false, error: message };
  }
}

// Fill null or "-" cost column from Raw Materials table (2:1 BOM), triggered via UI button or API
export async function update2to1CostAction(itemIds: string[]) {
  try {
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
  try {
    const updatedItemsMap = new Map<string, ReturnType<typeof serializeItem>>();
    let totalUpdated = 0;
    const errorMessages: string[] = [];

    // 1. Process DIRECT M2M product costs
    const m2mRes = await updateProductCostFromBomAction(itemIds);
    if (m2mRes.success && m2mRes.data) {
      for (const item of m2mRes.data.items) {
        updatedItemsMap.set(item.id, item);
      }
      totalUpdated += m2mRes.data.updated;
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

    if (totalUpdated === 0) {
      return { success: false, error: errorMessages.join(" ") || "No BOM costs updated." };
    }

    return {
      success: true,
      data: {
        items: Array.from(updatedItemsMap.values()),
        updated: totalUpdated,
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

export async function autoFillBlanksAction(itemIds: string[]) {
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, moc: true, size: true, pnRating: true, operationType: true, extension: true, bypass: true, itemTypeSource: true, mocSource: true, vaPercent: true, cost: true },
    })

    console.log(`\n=== [Server] AUTO-FILL BLANKS START ===`)
    console.log(`[Server] Total items to process: ${items.length}`)

    let updated = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      process.stdout.write(`\r[${i + 1}/${items.length}] ${item.itemName.substring(0, 60).padEnd(60)}`)

      const resolved = await resolveItemCategory({ itemName: item.itemName })
      const updates: any = {}
      if (!item.itemType && resolved.itemType) {
        updates.itemType = resolved.itemType
        updates.itemTypeSource = resolved.itemTypeSource
      }
      if (!item.moc && resolved.moc) {
        updates.moc = resolved.moc
        updates.mocSource = resolved.mocSource
      }
      if ((!item.size || item.size === "Not detectable" || item.size === "Not mentioned/cant detect size") && resolved.size && resolved.size !== "Not detectable") {
        updates.size = resolved.size
      }
      if (resolved.pnRating) {
        updates.pnRating = resolved.pnRating
      }
      if (!item.operationType && resolved.operationType) {
        updates.operationType = resolved.operationType
      }
      if ((!item.extension || item.extension === "-") && resolved.extension) {
        updates.extension = resolved.extension
      }
      if ((!item.bypass || item.bypass === "-") && resolved.bypass && resolved.bypass !== "-") {
        updates.bypass = resolved.bypass
      }
      if (Object.keys(updates).length > 0) {
        await prisma.enquiryItem.update({ where: { id: item.id }, data: updates })
        updated++
        console.log(`\n  ✓ ${item.itemName.substring(0, 50)}`)
        if (updates.itemType) console.log(`    itemType:  "${item.itemType || ""}" → "${updates.itemType}" (${updates.itemTypeSource})`)
        if (updates.moc) console.log(`    moc:       "${item.moc || ""}" → "${updates.moc}" (${updates.mocSource})`)
        if (updates.size) console.log(`    size:      "${item.size || ""}" → "${updates.size}"`)
        if (updates.pnRating) console.log(`    pnRating:  "${item.pnRating || ""}" → "${updates.pnRating}"`)
        if (updates.operationType) console.log(`    opType:    "${item.operationType || ""}" → "${updates.operationType}"`)
        if (updates.extension) console.log(`    extension: "${item.extension || ""}" → "${updates.extension}"`)
        if (updates.bypass) console.log(`    bypass:    "${item.bypass || ""}" → "${updates.bypass}"`)
      }

      const effectiveItemType = updates.itemType || item.itemType
      const effectiveSize = updates.size || item.size
      if (!item.vaPercent && effectiveItemType) {
        const defaultVa = getDefaultVaPercent(effectiveItemType, effectiveSize)
        if (defaultVa !== null) {
          await recalculateItem(item.id, { vaPercent: defaultVa })
          updated++
          console.log(`\n  ✓ ${item.itemName.substring(0, 50)}`)
          console.log(`    vaPercent: "" → "${defaultVa}" (auto from ${effectiveItemType} / ${effectiveSize || "any"})`)
        }
      }
    }

    console.log(`\n\n=== [Server] AUTO-FILL BLANKS DONE ===`)
    console.log(`[Server] Updated: ${updated} of ${items.length} items\n`)

    const refreshedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
    });

    return { success: true, updated, data: { items: refreshedItems.map(serializeItem) } }
  } catch (error: any) {
    console.error("Error auto-filling blanks:", error)
    return { success: false, error: error.message || "Failed to auto-fill blanks." }
  }
}

// Fill blank VA% values from the default VA% table (type + size based) using keyword item-type detection only
export async function updateVaPercentAction(itemIds: string[]) {
  try {
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
      console.log(`  ✓ ${item.itemName.substring(0, 50)}: VA% "" → "${defaultVa}" (from ${type} / ${item.size || "any"})`)
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

export async function setGMDUpdateTransferredAction(
  ids: string[],
  transferred: boolean,
) {
  "use server";
  try {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { success: true, data: { count: 0 } };
    }
    const res = await prisma.gMDUpdateItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: { transferred },
    });
    return { success: true, data: { count: res.count } };
  } catch (error: any) {
    console.error("Error updating GMD transfer status:", error);
    return {
      success: false,
      error: error.message || "Failed to update transfer status.",
    };
  }
}

export async function getTradingValveOptionsAction() {
  "use server";
  try {
    const rows = await prisma.gMDUpdateItem.findMany({
      where: {
        l8ItemCategory: {
          contains: "TRADING VALVE",
          mode: "insensitive",
        },
      },
      select: {
        l1: true,
        l2ValveType: true,
        l3Dia: true,
        l7Dimension: true,
        l4Component: true,
        l5Material: true,
        l6Std: true,
      },
    });
    const collect = (vals: (string | null)[]): string[] =>
      [...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      );
    return {
      success: true,
      data: {
        L1: collect(rows.map((r) => r.l1)),
        "L2-VALVE TYPE": collect(rows.map((r) => r.l2ValveType)),
        "L3-DIA": collect(rows.map((r) => r.l3Dia)),
        "L7-DIMENSION": collect(rows.map((r) => r.l7Dimension)),
        "L4-COMPONENT": collect(rows.map((r) => r.l4Component)),
        "L5- MATERIAL": collect(rows.map((r) => r.l5Material)),
        "L6-STD": collect(rows.map((r) => r.l6Std)),
      },
    };
  } catch (error: any) {
    console.error("Error fetching trading valve options:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch trading valve options.",
    };
  }
}

export async function updateGMDUpdateFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  const updated = await prisma.gMDUpdateItem.update({
    where: { id },
    data: { [field]: value },
  });
  console.log(`Updated GMDUpdateItem: ${id}, Field: ${field}, Value: ${value}, ${updated}`);
  console.dir(updated, { depth: Infinity });
  return { id, field, value };
}

export async function getUsdInrRateAction(refresh = false) {
  "use server";
  try {
    const { rate, fetchedAt } = await getUsdInrRate(refresh);
    return { success: true, data: { rate, fetchedAt } };
  } catch (error: any) {
    console.error("Error fetching USD/INR rate:", error);
    return { success: false, error: error.message || "Failed to fetch USD/INR rate." };
  }
}

export async function updateGMDUsdCostAction(id: string, usdCost: string | null) {
  "use server";
  try {
    const trimmed = usdCost?.trim() ?? "";
    if (!trimmed) {
      const existing = await prisma.gMDUpdateItem.findUnique({
        where: { id },
        select: { cost: true },
      });
      await prisma.gMDUpdateItem.update({
        where: { id },
        data: { usdRateOption: null },
      });
      return {
        success: true,
        data: { id, usdCost: null, cost: existing?.cost ?? null, rate: null, fetchedAt: new Date().toISOString() },
      };
    }
    const usd = parseFloat(trimmed.replace(/,/g, ""));
    if (isNaN(usd) || usd < 0) {
      return { success: false, error: "Invalid USD cost value." };
    }

    const { rate, fetchedAt } = await getUsdInrRate();
    const cost = (usd * rate).toFixed(2);

    await prisma.gMDUpdateItem.update({
      where: { id },
      data: { usdRateOption: String(usd), cost },
    });

    return { success: true, data: { id, usdCost: String(usd), cost, rate, fetchedAt } };
  } catch (error: any) {
    console.error("Error updating GMD USD cost:", error);
    return { success: false, error: error.message || "Failed to update USD cost." };
  }
}

export async function selectGMDUpdateBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  try {
    const item = await prisma.gMDUpdateItem.findUnique({
      where: { id },
      select: { erpItemCode: true },
    });
    if (!item) return { success: false, error: "Item not found." };
    const value = bomId?.trim() || null;
    if (value) {
      const ids = await getDistinctBomIds(item.erpItemCode ?? "");
      if (!ids.includes(value)) {
        return { success: false, error: "Selected BOM ID is not in available options." };
      }
    }
    await prisma.gMDUpdateItem.update({
      where: { id },
      data: { bomId: value },
    });
    return { success: true, data: { id, bomId: value } };
  } catch (error: any) {
    console.error("Error selecting GMD BOM ID:", error);
    return { success: false, error: error.message || "Failed to select BOM ID." };
  }
}

export async function selectContractReviewBomIdAction(
  id: string,
  bomId: string | null,
) {
  "use server";
  try {
    const item = await prisma.contractReview.findUnique({
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
      const vbRow = await prisma.verifyBom.findFirst({
        where: { itemCode: item.itemCode, bomId: value },
        select: { bomIdType: true },
      });
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await prisma.contractReview.findMany({
        where: { bomId: value },
        select: { id: true, bomId: true, orderQty: true },
      });
      const bomAvail = await getBomRmAvailBatch([value]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(id) ?? "";
      await prisma.contractReview.update({
        where: { id },
        data: { bomId: value, itemType, noUse: noUse || null },
      });
      return { success: true, data: { id, bomId: value, itemType, noUse } };
    }
    await prisma.contractReview.update({
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
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const rows = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, itemCode: true, actuator: true, bomId: true, orderQty: true },
    });
    const unresolved = rows.filter((r) => !r.bomId && r.actuator?.includes("@"));
    const bomIdByRow = await resolveContractReviewBomIdsFromActuator(unresolved);

    const results: { id: string; bomId: string; itemType: string; noUse: string | null }[] = [];
    for (const row of unresolved) {
      const bomId = bomIdByRow.get(row.id);
      if (!bomId) continue;
      const vbRow = await prisma.verifyBom.findFirst({
        where: { itemCode: row.itemCode, bomId },
        select: { bomIdType: true },
      });
      const itemType = (vbRow?.bomIdType ?? "").trim()
        ? vbRow!.bomIdType!
        : "no itemtype present";
      const groupRows = await prisma.contractReview.findMany({
        where: { bomId },
        select: { id: true, bomId: true, orderQty: true },
      });
      if (!groupRows.some((g) => g.id === row.id)) {
        groupRows.push({ id: row.id, bomId, orderQty: row.orderQty });
      }
      const bomAvail = await getBomRmAvailBatch([bomId]);
      const availMap = computeContractReviewRmAvail(groupRows, bomAvail);
      const noUse = availMap.get(row.id) ?? null;
      await prisma.contractReview.update({
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
  try {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return { success: true, data: [] };
    const items = await prisma.contractReview.findMany({
      where: { id: { in: unique } },
      select: { id: true, bomId: true, orderQty: true },
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
      .map((i) =>
        prisma.contractReview.update({
          where: { id: i.id },
          data: { noUse: availMap.get(i.id) ?? null },
        }),
      );
    if (updates.length > 0) {
      await prisma.$transaction(updates);
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

export async function updateContractReviewFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  try {
    await prisma.contractReview.update({
      where: { id },
      data: { [field]: value },
    });
    return { success: true, data: { id, field, value } };
  } catch (error: any) {
    console.error("Error updating ContractReview field:", error);
    return {
      success: false,
      error: error.message || "Failed to update ContractReview field.",
    };
  }
}

const VERIFY_BOM_EDITABLE_FIELDS = new Set(["bomIdType"]);

export async function updateVerifyBomFieldBatchAction(
  ids: string[],
  field: string,
  value: string | null,
) {
  "use server";
  try {
    if (!VERIFY_BOM_EDITABLE_FIELDS.has(field)) {
      return { success: false, error: `Field "${field}" is not editable.` };
    }
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) {
      return { success: true, count: 0 };
    }
    await prisma.$transaction(
      unique.map((id) =>
        prisma.verifyBom.update({
          where: { id },
          data: { [field]: value },
        }),
      ),
    );
    return { success: true, count: unique.length };
  } catch (error: any) {
    console.error("Error updating VerifyBom fields:", error);
    return {
      success: false,
      error: error.message || "Failed to update VerifyBom fields.",
    };
  }
}

export async function updateSupplyHistoryFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
  const updated = await prisma.supplyHistoryItem.update(
    {
      where: { id },
      data: { [field]: value },
    }
  );
  return { id, field, value };
}

export async function updateBisStatusFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  "use server";
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

export async function getGMDCastingRatesAction() {
  "use server";
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

// Match each EnquiryItem's erpItemCode against ContractReview.itemCode and
// populate contractReviewRate with the rate from the most-recent contract row.
export async function fetchContractReviewRatesAction(itemIds: string[]) {
  try {
    // 1. Fetch the items we care about
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, erpItemCode: true, productCost: true },
    });

    // 2. Collect unique non-null erpItemCodes
    const codes = [...new Set(items.map((i) => i.erpItemCode).filter(Boolean))] as string[];
    if (codes.length === 0) {
      return { success: false, error: "No ERP item codes found on selected items." };
    }

    // 3. For each distinct code, find the ContractReview row with the most-recent dateOfContract.
    //    We fetch all matching rows and pick the best one in JS so we avoid complex raw SQL.
    const contractRows = await prisma.contractReview.findMany({
      where: { itemCode: { in: codes } },
      select: { itemCode: true, rate: true, dateOfContract: true, createdAt: true },
    });

    // Build a map: itemCode → best rate (most recent dateOfContract, then createdAt)
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

    // 4. Update each matching item
    const updatedItems: ReturnType<typeof serializeItem>[] = [];
    let updated = 0;

    for (const item of items) {
      if (!item.erpItemCode) continue;
      const rate = bestRateMap.get(item.erpItemCode);
      if (rate === undefined) continue; // no contract row for this code

      let pdVal: string | null = null;
      if (rate && item.productCost != null) {
        const cr = parseFloat(String(rate).replace(/,/g, ""));
        const pc = Number(item.productCost);
        if (!isNaN(cr) && !isNaN(pc) && pc !== 0) {
          pdVal = `${(((cr - pc) / pc) * 100).toFixed(2)}%`;
        }
      }

      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: { contractReviewRate: rate, pdcostValidation: pdVal },
      });

      const refreshed = await prisma.enquiryItem.findUnique({ where: { id: item.id } });
      if (refreshed) {
        updatedItems.push(serializeItem(refreshed));
        updated++;
      }
    }

    if (updated === 0) {
      return { success: false, error: "No matching contract review rows found for the selected items." };
    }
    return { success: true, data: { items: updatedItems, updated } };
  } catch (error: any) {
    console.error("Error fetching contract review rates:", error);
    return { success: false, error: error.message || "Failed to fetch contract review rates." };
  }
}

// Calculate and populate pdcostValidation % for selected items that have contractReviewRate and productCost
export async function populatePdCostValidationAction(itemIds: string[]) {
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
  try {
    if (!itemIds || itemIds.length === 0) {
      return { success: false, error: "No items selected." };
    }
    const uniqueIds = [...new Set(itemIds)];

    const existing = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    console.log(`[Server] clearQuotedRates ids=${uniqueIds.length}`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: {
        quotedRate: null,
        quotedRateGst: null,
        itemWiseTotalValue: null,
        totalValue: null,
      },
    });

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), cleared: updatedItems.length } };
  } catch (error: any) {
    console.error("Error clearing quoted rates:", error);
    return { success: false, error: error.message || "Failed to clear quoted rates." };
  }
}

// Bulk update apm for many enquiries (all pages, filtered scope). Allowed values: "Yes", "No", null/"" for clear.
// Now enquiry-based after migration add_apm_in_enquiry. Gated to admin/developer.
export async function bulkUpdateApmAction(enquiryIds: string[], apm: string | null) {
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

    await prisma.enquiry.updateMany({
      where: { id: { in: uniqueIds } },
      data: { apm: normalized },
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
      select: { id: true },
    });
    if (existing.length !== uniqueIds.length) {
      return { success: false, error: "Some items not found. Please refresh and try again." };
    }

    console.log(`[Server] bulkValidation ids=${uniqueIds.length} set="${normalized ?? ""}"`);

    await prisma.enquiryItem.updateMany({
      where: { id: { in: uniqueIds } },
      data: { validation: normalized },
    });

    const updatedItems = await prisma.enquiryItem.findMany({
      where: { id: { in: uniqueIds } },
    });

    return { success: true, data: { items: updatedItems.map(serializeItem), updated: updatedItems.length, validation: normalized } };
  } catch (error: any) {
    console.error("Error bulk updating validation:", error);
    return { success: false, error: error.message || "Failed to update validation." };
  }
}
