"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

// Create a new enquiry with initial items
export async function createNewEnquiryAction(formData: {
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  attachmentName?: string;
  items: { itemName: string; quantity: number }[];
}) {
  try {
    // Check if docketNumber already exists
    const existing = await prisma.enquiry.findUnique({
      where: { docketNumber: formData.docketNumber },
    });

    if (existing) {
      return { success: false, error: "Docket Number already exists." };
    }

    await prisma.enquiry.create({
      data: {
        docketNumber: formData.docketNumber,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        attachmentName: formData.attachmentName || null,
        attachmentUrl: formData.attachmentName ? `/files/${formData.attachmentName}` : null,
        attachmentType: formData.attachmentName ? formData.attachmentName.split(".").pop() : null,
        attachmentSize: formData.attachmentName ? Math.floor(Math.random() * 50000) + 1000 : null,
        items: {
          create: formData.items.map((item) => ({
            itemName: item.itemName,
            quantity: item.quantity,
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
  items: { itemName: string; quantity: number }[];
}) {
  try {
    await prisma.enquiryItem.createMany({
      data: formData.items.map((item) => ({
        enquiryId: formData.enquiryId,
        itemName: item.itemName,
        quantity: item.quantity,
      })),
    });

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error adding items:", error);
    return { success: false, error: error.message || "Failed to add items." };
  }
}

// Update a specific item and/or its parent enquiry fields
export async function updateEnquiryItemAction(formData: {
  itemId: string;
  itemName: string;
  quantity: number;
  docketNumber: string;
  partyName: string;
  enquiryDate: string;
  attachmentName?: string;
}) {
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: formData.itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    // Check if new docket number conflicts with another enquiry
    const conflictingEnquiry = await prisma.enquiry.findFirst({
      where: {
        docketNumber: formData.docketNumber,
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
      },
    });

    // Update parent enquiry
    await prisma.enquiry.update({
      where: { id: item.enquiryId },
      data: {
        docketNumber: formData.docketNumber,
        partyName: formData.partyName,
        enquiryDate: new Date(formData.enquiryDate),
        ...(formData.attachmentName !== undefined
          ? {
              attachmentName: formData.attachmentName || null,
              attachmentUrl: formData.attachmentName ? `/files/${formData.attachmentName}` : null,
              attachmentType: formData.attachmentName ? formData.attachmentName.split(".").pop() : null,
              attachmentSize: formData.attachmentName ? Math.floor(Math.random() * 50000) + 1000 : null,
            }
          : {}),
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error updating enquiry item:", error);
    return { success: false, error: error.message || "Failed to update item." };
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
