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
  vaPercent?: number | null;
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

    await prisma.enquiry.create({
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
        vaPercent: formData.vaPercent || null,
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
          })),
        },
      },
    });

    revalidatePath("/");
    return { success: true };
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
        vaPercent: formData.vaPercent || null,
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
    if (field === "vaPercent" && value !== null) {
      parsedVal = parseFloat(String(value).replace(/%/g, "")) || null;
    }
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { [field]: parsedVal },
    });
    revalidatePath("/");
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
    if (["quantity", "productCost", "cost", "discount"].includes(field) && value !== null) {
      parsedVal = parseFloat(String(value)) || 0;
    }
    await prisma.enquiryItem.update({
      where: { id: itemId },
      data: { [field]: parsedVal },
    });
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error(`Error updating item ${field}:`, error);
    return { success: false, error: error.message || `Failed to update ${field}.` };
  }
}
