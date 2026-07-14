"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";
import { recalculateItem, recalculateEnquiryItems, serializeItem, serializeEnquiry, autoDetectItemType, autoDetectMoc } from "@/lib/costCalculator";
import { resolveItemCategory } from "@/lib/itemCategoryResolver";
import { extractSizeFromItemName } from "@/lib/sizeExtractor";
import { roundToNearest10 } from "@/lib/rounding";

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
    productCost?: number | null;
    costRefCode?: string | null;
    cost?: number | null;
    stockStatus?: string | null;
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
        });
        return {
          ...item,
          resolved,
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
          create: resolvedItems.map((item) => {
            const itemCost = item.cost || null;
            const itemVa = item.vaPercent || null;
            let itemQR: string | null = null;
            if (itemCost !== null && itemCost > 0 && itemVa !== null) {
              itemQR = (itemCost * (1 + (itemVa / 100))).toFixed(2);
            }
            return {
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
              productCost: item.productCost || null,
              costRefCode: item.costRefCode || null,
              cost: itemCost,
              stockStatus: item.stockStatus || null,
              discount: item.discount || null,
              vaPercent: itemVa !== null ? String(itemVa) : null,
              quotedRate: itemQR,
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
        items: { orderBy: { createdAt: "asc" } },
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
    productCost?: number;
    costRefCode?: string;
    cost?: number;
    stockStatus?: string;
    discount?: number;
    vaPercent?: number;
  }[];
}) {
  try {
    const resolvedItems = await Promise.all(
      formData.items.map(async (item) => {
        const resolved = await resolveItemCategory({
          itemName: item.itemName,
          sheetItemType: item.itemType,
          sheetMoc: item.moc,
          sheetSize: item.size,
        });
        return {
          ...item,
          resolved,
        };
      })
    );

    await prisma.enquiryItem.createMany({
      data: resolvedItems.map((item) => {
        const itemCost = item.cost || null;
        const itemVa = item.vaPercent || null;
        let itemQR: string | null = null;
        if (itemCost !== null && itemCost > 0 && itemVa !== null) {
          itemQR = (itemCost * (1 + (itemVa / 100))).toFixed(2);
        }
        return {
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
          productCost: item.productCost || null,
          costRefCode: item.costRefCode || null,
          cost: itemCost,
          stockStatus: item.stockStatus || null,
          discount: item.discount || null,
          vaPercent: itemVa !== null ? String(itemVa) : null,
          quotedRate: itemQR,
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

    revalidatePath("/");
    return { success: true };
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
  productCost?: number;
  costRefCode?: string;
  cost?: number;
  stockStatus?: string;
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
          finalQuotedRate = roundToNearest10(qrNum).toFixed(2);
        }
      }
    } else {
      // Forward: QR not provided — calculate from Cost+VA% if both exist
      if (updatedCost !== null && updatedCost > 0 && finalVa !== null) {
        const qr = updatedCost * (1 + (finalVa / 100));
        finalQuotedRate = roundToNearest10(qr).toFixed(2);
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
    });

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
        pnRating: formData.pnRating || null,
        operationType: formData.operationType || null,
        extension: formData.extension || null,
        bypass: formData.bypass || null,
        productCost: formData.productCost || null,
        costRefCode: formData.costRefCode || null,
        cost: formData.cost || null,
        stockStatus: formData.stockStatus || null,
        discount: formData.discount || null,
        vaPercent: finalVa !== null ? String(finalVa) : null,
        quotedRate: finalQuotedRate,
        quotedRateGst: finalQuotedRateGst,
        itemWiseTotalValue: updatedItemWise,
        totalValue: updatedTotalVal,
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

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error updating enquiry item:", error);
    return { success: false, error: error.message || "Failed to update item." };
  }
}

// Update the orderStatus of an enquiry directly
export async function updateEnquiryOrderStatusAction(enquiryId: string, orderStatus: string) {
  try {
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { orderStatus },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message || "Failed to update order status." };
  }
}

// Delete an item. If it is the last item, delete the enquiry itself.
export async function deleteEnquiryItemAction(itemId: string) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    // Count remaining items in parent enquiry
    const remainingItemsCount = await prisma.enquiryItem.count({
      where: { enquiryId: item.enquiryId },
    });

    // Delete item
    await prisma.enquiryItem.delete({
      where: { id: itemId },
    });

    // If it was the last item, delete the entire enquiry
    if (remainingItemsCount <= 1) {
      await prisma.enquiry.delete({
        where: { id: item.enquiryId },
      });
    }

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting item:", error);
    return { success: false, error: error.message || "Failed to delete item." };
  }
}

// Update a specific field of an enquiry directly (for inline cell editing)
export async function updateEnquiryFieldAction(
  enquiryId: string,
  field: string,
  value: any
) {
  try {
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
      include: { items: true },
    });

    revalidatePath("/");
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
    let parsedVal = value;
    if (field === "vaPercent" && value !== null) {
      const num = parseFloat(String(value).replace(/%/g, ""));
      parsedVal = !isNaN(num) ? String(num) : null;
    } else if (["quantity", "productCost", "cost", "discount"].includes(field) && value !== null) {
      parsedVal = parseFloat(String(value)) || 0;
    }

    let updatedItem;
    if (["productCost", "extension", "bypass", "quantity", "vaPercent", "quotedRate"].includes(field)) {
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
          select: { itemType: true, moc: true, itemTypeSource: true, mocSource: true },
        });
        const resolved = await resolveItemCategory({
          itemName: parsedVal,
          sheetItemType: currentItem?.itemTypeSource === "sheet" ? currentItem.itemType : null,
          sheetMoc: currentItem?.mocSource === "sheet" ? currentItem.moc : null,
          sheetSize: null,
        });
        updateData.itemType = resolved.itemType;
        updateData.moc = resolved.moc;
        updateData.itemTypeSource = resolved.itemTypeSource;
        updateData.mocSource = resolved.mocSource;
        updateData.size = resolved.size;
      } else if (field === "itemType") {
        updateData.itemTypeSource = "sheet";
      } else if (field === "moc") {
        updateData.mocSource = "sheet";
      }
      const dbItem = await prisma.enquiryItem.update({
        where: { id: itemId },
        data: updateData,
      });
      updatedItem = serializeItem(dbItem);
    }

    revalidatePath("/");
    return { success: true, data: updatedItem };
  } catch (error: any) {
    console.error(`Error updating item ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${itemId}.` };
  }
}

export async function importExcelDataAction(rows: any[]) {
  try {
    let matchedCount = 0;
    let updatedCount = 0;

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
      updatedCount++;
    }

    revalidatePath("/");
    return { success: true, matchedCount, updatedCount };
  } catch (error: any) {
    console.error("Error importing excel data:", error);
    return { success: false, error: error.message || "Failed to import excel data." };
  }
}

export async function autoFillBlanksAction(itemIds: string[]) {
  try {
    const items = await prisma.enquiryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, itemName: true, itemType: true, moc: true, size: true, itemTypeSource: true, mocSource: true },
    })

    console.log(`\n=== AUTO-FILL BLANKS START ===`)
    console.log(`Total items to process: ${items.length}`)

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
      if (Object.keys(updates).length > 0) {
        await prisma.enquiryItem.update({ where: { id: item.id }, data: updates })
        updated++
        console.log(`\n  ✓ ${item.itemName.substring(0, 50)}`)
        if (updates.itemType) console.log(`    itemType: "${item.itemType || ""}" → "${updates.itemType}" (${updates.itemTypeSource})`)
        if (updates.moc) console.log(`    moc:      "${item.moc || ""}" → "${updates.moc}" (${updates.mocSource})`)
        if (updates.size) console.log(`    size:     "${item.size || ""}" → "${updates.size}"`)
      }
    }

    console.log(`\n\n=== AUTO-FILL BLANKS DONE ===`)
    console.log(`Updated: ${updated} of ${items.length} items\n`)

    revalidatePath("/")
    return { success: true, updated }
  } catch (error: any) {
    console.error("Error auto-filling blanks:", error)
    return { success: false, error: error.message || "Failed to auto-fill blanks." }
  }
}

