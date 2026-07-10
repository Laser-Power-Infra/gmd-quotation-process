"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";

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
          create: formData.items.map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity,
            itemType: item.itemType || null,
            moc: item.moc || null,
            size: item.size || null,
            pnRating: item.pnRating || null,
            operationType: item.operationType || null,
            extension: item.extension || null,
            bypass: item.bypass || null,
            productCost: item.productCost || null,
            costRefCode: item.costRefCode || null,
            cost: item.cost || null,
            stockStatus: item.stockStatus || null,
            discount: item.discount || null,
            vaPercent: item.vaPercent || null,
          })),
        },
      },
      include: {
        items: true,
        attachments: true,
      },
    });

    const serialized = {
      ...created,
      items: created.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        productCost: item.productCost ? Number(item.productCost) : null,
        cost: item.cost ? Number(item.cost) : null,
        discount: item.discount ? Number(item.discount) : null,
        vaPercent: item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null,
        quotedRate: item.quotedRate || null,
      })),
    };

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
    await prisma.enquiryItem.createMany({
      data: formData.items.map((item) => ({
        enquiryId: formData.enquiryId,
        itemName: item.itemName,
        quantity: item.quantity,
        itemType: item.itemType || null,
        moc: item.moc || null,
        size: item.size || null,
        pnRating: item.pnRating || null,
        operationType: item.operationType || null,
        extension: item.extension || null,
        bypass: item.bypass || null,
        productCost: item.productCost || null,
        costRefCode: item.costRefCode || null,
        cost: item.cost || null,
        stockStatus: item.stockStatus || null,
        discount: item.discount || null,
        vaPercent: item.vaPercent || null,
      })),
    });

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

    let updatedQuotedRate = item.quotedRate;
    let updatedItemWise = item.itemWiseTotalValue;
    let updatedTotalVal = item.totalValue;

    if (updatedCost !== null && updatedCost > 0) {
      if (updatedVa !== null) {
        const qr = updatedCost * (1 + (updatedVa / 100));
        updatedQuotedRate = qr.toFixed(2);
      } else {
        updatedQuotedRate = null;
      }
    } else {
      updatedQuotedRate = null;
    }

    if (updatedQuotedRate) {
      const qrFloat = parseFloat(updatedQuotedRate);
      if (updatedQty > 0 && qrFloat > 0) {
        const itemWise = updatedQty * qrFloat;
        updatedItemWise = itemWise.toFixed(2);
        updatedTotalVal = (itemWise * 1.18).toFixed(2);
      } else {
        updatedItemWise = null;
        updatedTotalVal = null;
      }
    } else {
      updatedItemWise = null;
      updatedTotalVal = null;
    }

    // Update item
    await prisma.enquiryItem.update({
      where: { id: formData.itemId },
      data: {
        itemName: formData.itemName,
        quantity: formData.quantity,
        itemType: formData.itemType || null,
        moc: formData.moc || null,
        size: formData.size || null,
        pnRating: formData.pnRating || null,
        operationType: formData.operationType || null,
        extension: formData.extension || null,
        bypass: formData.bypass || null,
        productCost: formData.productCost || null,
        costRefCode: formData.costRefCode || null,
        cost: formData.cost || null,
        stockStatus: formData.stockStatus || null,
        discount: formData.discount || null,
        vaPercent: formData.vaPercent !== undefined ? formData.vaPercent : null,
        quotedRate: updatedQuotedRate,
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
    return { success: true };
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
      parsedVal = parseFloat(String(value).replace(/%/g, "")) || null;
    } else if (["quantity", "productCost", "cost", "discount"].includes(field) && value !== null) {
      parsedVal = parseFloat(String(value)) || 0;
    }
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { [field]: parsedVal },
    });
    return { success: true };
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

      const existingCost = item.cost ? parseFloat(item.cost.toString()) : null;
      const existingVa = item.vaPercent !== null ? parseFloat(item.vaPercent.toString()) : null;
      const existingQuotedRate = item.quotedRate ? parseFloat(item.quotedRate) : null;
      const quantity = item.quantity ? parseFloat(item.quantity.toString()) : 0;

      let newCost = existingCost;
      let newVa = existingVa;
      let newQuotedRate = existingQuotedRate;

      if (cost !== undefined && cost !== null && cost !== "") {
        newCost = parseFloat(String(cost));
      }
      if (quotedRate !== undefined && quotedRate !== null && quotedRate !== "") {
        newQuotedRate = parseFloat(String(quotedRate));
      }

      // If cost changed and vaPercent exists, recalculate quotedRate:
      if (
        cost !== undefined &&
        cost !== null &&
        cost !== "" &&
        newCost !== null &&
        newCost > 0 &&
        newVa !== null &&
        (quotedRate === undefined || quotedRate === null || quotedRate === "")
      ) {
        newQuotedRate = parseFloat((newCost * (1 + newVa / 100)).toFixed(2));
      }

      // If quotedRate changed and cost exists, recalculate vaPercent:
      if (
        quotedRate !== undefined &&
        quotedRate !== null &&
        quotedRate !== "" &&
        newQuotedRate !== null &&
        newQuotedRate > 0 &&
        newCost !== null &&
        newCost > 0
      ) {
        newVa = parseFloat((((newQuotedRate / newCost) - 1) * 100).toFixed(2));
      }

      // Recalculate totals
      let itemWiseTotal = null;
      let totalVal = null;
      if (quantity > 0 && newQuotedRate !== null && newQuotedRate > 0) {
        const itemWise = quantity * newQuotedRate;
        itemWiseTotal = itemWise.toFixed(2);
        totalVal = (itemWise * 1.18).toFixed(2);
      }

      // Update EnquiryItem in database
      await prisma.enquiryItem.update({
        where: { id: item.id },
        data: {
          cost: newCost,
          quotedRate: newQuotedRate !== null ? newQuotedRate.toFixed(2) : null,
          vaPercent: newVa,
          itemWiseTotalValue: itemWiseTotal,
          totalValue: totalVal,
        },
      });

      updatedCount++;
    }

    revalidatePath("/");
    return { success: true, matchedCount, updatedCount };
  } catch (error: any) {
    console.error("Error importing excel data:", error);
    return { success: false, error: error.message || "Failed to import excel data." };
  }
}

