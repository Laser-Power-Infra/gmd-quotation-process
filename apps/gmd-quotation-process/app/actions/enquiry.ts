"use server";
import { requireAccess } from "@/lib/access";
import { syncAvailableBomIds, maybeUpdateProductCostFromNewCode } from "@/lib/itemBomSync";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import { prisma } from "@/lib/prisma";
import { uploadFileToDrive } from "@/lib/gdrive";
import { recalculateItem, recalculateEnquiryItems, serializeItem, serializeEnquiry } from "@/lib/costCalculator";
import { resolveItemCategory } from "@/lib/itemCategoryResolver";
import { roundUp } from "@/lib/rounding";
import { getDefaultVaPercent } from "@/lib/vaValidation";
import { buildDocketEmailHtml, buildDocketEmailSubject, buildItemsClause } from "@/lib/docketEmailTemplate";
import { sendDocketEmailViaN8n, DOCKET_EMAIL_ALWAYS_CC } from "@/lib/services/n8nEmail";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { computeDeliverySchedule, DEFAULT_DELIVERY_SCHEDULE } from "@/lib/deliverySchedule";
import { resolveImportedInhouse } from "@/lib/importInhouseMapping";
import { syncEnquiryEmailAddresses } from "@/lib/enquiryEmailSync";
import { mergeMandatoryCc, isBlockedPartyEmail } from "@/lib/enquiryEmailParty";
import { isDeletableDuplicate } from "@/lib/pendingDocketMaterializer";

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
  await requireAccess();
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
            const importedInhouse = resolveImportedInhouse(item.resolved.itemType, item.resolved.size, item.itemName);
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
              importedInhouse,
              deliverySchedule: computeDeliverySchedule(item.quantity, item.availableStock, item.resolved.size, importedInhouse) ?? DEFAULT_DELIVERY_SCHEDULE,
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

    // Backfill contractNo for the new docket by party name so the Contract Review column is populated without manual script
    try {
      const { syncSingleEnquiryContractNumbers } = await import("@/lib/syncEnquiryContractNumbers");
      await syncSingleEnquiryContractNumbers(created.id, formData.partyName);
    } catch (e) {
      console.warn("[createNewEnquiryAction] contractNo sync skipped:", e);
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
  await requireAccess();
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
        const importedInhouse = resolveImportedInhouse(item.resolved.itemType, item.resolved.size, item.itemName);
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
          importedInhouse,
          deliverySchedule: computeDeliverySchedule(item.quantity, item.availableStock, item.resolved.size, importedInhouse) ?? DEFAULT_DELIVERY_SCHEDULE,
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
  await requireAccess();
  try {
    const item = await prisma.enquiryItem.findUnique({
      where: { id: formData.itemId },
    });

    if (!item) {
      return { success: false, error: "Item not found." };
    }

    console.log(`[Server] updateEnquiryItem item=${formData.itemId}`);
    // Freeze pricing columns when parent enquiry is in one-time-consumed state.
    // Quantity is included per "make it frozen as well" requirement.
    {
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      const parent = await prisma.enquiry.findUnique({
        where: { id: item.enquiryId },
        select: { apm: true, offerPdfGeneratedAt: true },
      });
      if (parent && isEnquiryFrozen(parent.apm, parent.offerPdfGeneratedAt)) {
        const frozenChanged =
          (formData.quantity !== undefined && formData.quantity !== Number(item.quantity)) ||
          (formData.productCost !== undefined && formData.productCost !== (item.productCost ? Number(item.productCost) : null)) ||
          (formData.costRefCode !== undefined && (formData.costRefCode ?? null) !== (item.costRefCode ?? null)) ||
          (formData.cost !== undefined && formData.cost !== (item.cost ? Number(item.cost) : null)) ||
          (formData.discount !== undefined && formData.discount !== (item.discount ? Number(item.discount) : null)) ||
          (formData.vaPercent !== undefined && formData.vaPercent !== (item.vaPercent !== null && item.vaPercent !== undefined ? Number(item.vaPercent) : null)) ||
          (formData.quotedRate !== undefined && (formData.quotedRate || null) !== (item.quotedRate || null));
        if (frozenChanged) {
          return { success: false, error: "Rate & cost columns are frozen after one-time PDF generation â€” revert APM to edit." };
        }
      }
    }
    const fieldDiffs: string[] = [];
    if (formData.itemName !== item.itemName) fieldDiffs.push(`itemName: "${item.itemName}" â†’ "${formData.itemName}"`);
    if (formData.itemType !== undefined && formData.itemType !== item.itemType) fieldDiffs.push(`itemType: "${item.itemType}" â†’ "${formData.itemType}"`);
    if (formData.moc !== undefined && formData.moc !== item.moc) fieldDiffs.push(`moc: "${item.moc}" â†’ "${formData.moc}"`);
    if (formData.size !== undefined && formData.size !== item.size) fieldDiffs.push(`size: "${item.size}" â†’ "${formData.size}"`);
    if (formData.operationType !== undefined && formData.operationType !== item.operationType) fieldDiffs.push(`opType: "${item.operationType}" â†’ "${formData.operationType}"`);
    if (formData.extension !== undefined && formData.extension !== item.extension) fieldDiffs.push(`extension: "${item.extension}" â†’ "${formData.extension}"`);
    if (formData.bypass !== undefined && formData.bypass !== item.bypass) fieldDiffs.push(`bypass: "${item.bypass}" â†’ "${formData.bypass}"`);
    if (formData.quantity !== undefined && formData.quantity !== Number(item.quantity)) fieldDiffs.push(`qty: "${item.quantity}" â†’ "${formData.quantity}"`);
    if (formData.cost !== undefined && formData.cost !== (item.cost ? Number(item.cost) : null)) fieldDiffs.push(`cost: "${item.cost}" â†’ "${formData.cost}"`);
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
      // Reverse: QR explicitly provided â€” calculate VA% from QR/Cost
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
      // Forward: QR not provided â€” calculate from Cost+VA% if both exist
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
    // Re-derive import/in-house only when the source specs changed; otherwise keep
    // any existing (possibly manual) value, filling it in if still empty.
    const importInhouseSpecsChanged =
      resolved.itemType !== item.itemType || (resolved.size ?? null) !== (item.size ?? null);
    const derivedImportedInhouse = resolveImportedInhouse(resolved.itemType, resolved.size, formData.itemName);
    const itemImportedInhouse = importInhouseSpecsChanged
      ? derivedImportedInhouse
      : item.importedInhouse ?? derivedImportedInhouse;
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
        importedInhouse: itemImportedInhouse,
        deliverySchedule: item.deliveryScheduleOverride
          ? item.deliverySchedule
          : computeDeliverySchedule(updatedQty, formData.availableStock !== undefined ? formData.availableStock : item.availableStock, resolved.size, itemImportedInhouse) ?? DEFAULT_DELIVERY_SCHEDULE,
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
  await requireAccess();
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
  await requireAccess();
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

// Find ContractReview rows matching any of the given contract numbers
export async function updateOrderStatus(contractNos: string[], docketNo: string) {
  await requireAccess();
  try {
    const rows = await tenderPrisma.contractReview.findMany({
      where: { contractNo: { in: contractNos } },
      select: { id: true, contractNo: true, itemCode: true, rate: true, orderQty: true },
      orderBy: { contractNo: "asc" },
    });

    const contractTotal = rows.reduce((sum, r) => {
      const rate = Number(String(r.rate ?? "").replace(/,/g, "").trim());
      const qty = Number(String(r.orderQty ?? "").replace(/,/g, "").trim());
      return sum + (Number.isFinite(rate) && Number.isFinite(qty) ? rate * qty : 0);
    }, 0);

    const enquiry = await prisma.enquiry.findUnique({
      where: { docketNumber: docketNo },
      include: { items: { select: { totalValue: true } } },
    });

    if (!enquiry) {
      return { success: false, error: `Enquiry not found for docket: ${docketNo}` };
    }

    const enquiryTotal = enquiry.items.reduce((sum, it) => {
      const v = Number(String(it.totalValue ?? "").replace(/,/g, "").trim());
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    const difference = contractTotal - enquiryTotal;

    return { success: true, rows, contractTotal, enquiryTotal, difference };
  } catch (error: any) {
    console.error("Error updating order status:", error);
    return { success: false, error: error.message || "Failed to update order status." };
  }
}

// Delete an item. Enquiry is retained even if it becomes empty.
export async function deleteEnquiryItemAction(itemId: string) {
  await requireAccess();
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

/**
 * Deletes a docket that was flagged as a duplicate of another docket, together
 * with its items (Prisma cascade on EnquiryItem / Attachment).
 *
 * Safety: only allowed when `duplicate === "Yes"` and a `duplicateOfDocket`
 * pointing at a *different*, still-existing docket is set. The source thread
 * (matched by docketNo) is re-pointed at the original docket so the mail links
 * there and the duplicate is never recreated.
 */
export async function deleteEnquiryAction(enquiryId: string) {
  await requireAccess();
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: {
        id: true,
        docketNumber: true,
        sourceThreadId: true,
        duplicate: true,
        duplicateOfDocket: true,
      },
    });
    if (!enquiry) {
      return { success: false as const, error: "Docket not found." };
    }

    if (
      !isDeletableDuplicate({
        duplicate: enquiry.duplicate,
        duplicateOfDocket: enquiry.duplicateOfDocket,
      })
    ) {
      return {
        success: false as const,
        error:
          "Only a docket flagged as Duplicate = Yes with a selected original can be deleted.",
      };
    }

    const original = String(enquiry.duplicateOfDocket).trim();
    if (original === enquiry.docketNumber) {
      return {
        success: false as const,
        error: "The original docket cannot be itself. Pick a different original docket.",
      };
    }
    const originalExists = await prisma.enquiry.findUnique({
      where: { docketNumber: original },
      select: { id: true, sourceThreadId: true },
    });
    if (!originalExists) {
      return { success: false as const, error: `Original docket "${original}" no longer exists.` };
    }

    // Link the source mail(s) to the original docket, then remove the duplicate
    // and its items. `duplicateOfDocket` survives the ingestion's re-sync, so the
    // mail cannot be docketed again even after docketNo is cleared.
    await prisma.docketQuotationThread.updateMany({
      where: {
        OR: [
          { docketNo: enquiry.docketNumber },
          ...(enquiry.sourceThreadId ? [{ threadId: enquiry.sourceThreadId }] : []),
        ],
      },
      data: {
        docketNo: original,
        pendingDocket: false,
        duplicateOfDocket: original,
      },
    });

    await prisma.enquiry.delete({ where: { id: enquiryId } });

    // The duplicate may be the row holding the durable mail link; move it to the
    // original once the unique sourceThreadId is free.
    if (enquiry.sourceThreadId && !originalExists.sourceThreadId) {
      try {
        await prisma.enquiry.update({
          where: { id: originalExists.id },
          data: { sourceThreadId: enquiry.sourceThreadId },
        });
      } catch (e) {
        console.warn(
          `[Server] could not move sourceThreadId to ${original}; thread is still folded:`,
          e,
        );
      }
    }

    console.log(
      `[Server] deleteEnquiry (duplicate) ${enquiry.docketNumber} -> original ${original}`,
    );

    return {
      success: true as const,
      data: { enquiryId, docketNumber: enquiry.docketNumber, duplicateOfDocket: original },
    };

  } catch (error: unknown) {
    console.error("Error deleting duplicate enquiry:", error);
    const message = error instanceof Error ? error.message : "Failed to delete docket.";
    return { success: false as const, error: message };
  }
}

// Update a specific field of an enquiry directly (for inline cell editing)
export async function updateEnquiryFieldAction(
  enquiryId: string,
  field: string,
  value: any
) {
  await requireAccess();
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
    // Duplicate flag is a plain Yes/No marker.
    if (field === "duplicate") {
      if (value !== null && value !== "" && value !== "Yes" && value !== "No") {
        return { success: false, error: "Duplicate must be Yes, No, or blank." };
      }
    }
    // Docket email approval (tick/cross). Cross (false) also clears the sent
    // marker so the docket can be re-approved and sent again.
    if (field === "emailApproved") {
      if (value !== true && value !== false) {
        return { success: false, error: "emailApproved must be true or false." };
      }
    }
    const prev = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { [field]: true },
    });
    const oldVal = prev ? (prev as any)[field] : undefined;
    console.log(`[Server] updateEnquiryField enquiry=${enquiryId} field=${field} old="${oldVal}" new="${value}"`);

    let parsedVal = value;
    // When APM leaves "Yes" (cleared or set to "No"), reset the one-time PDF freeze so a future
    // "Yes" grants a fresh one-time download and pricing columns unfreeze.
    const data: Record<string, any> = { [field]: parsedVal };
    if (field === "apm" && parsedVal !== "Yes") {
      data.offerPdfGeneratedAt = null;
      data.offerPdfGeneratedBy = null;
    }
    // Cross (un-approve) also clears the sent marker so a resend can happen.
    if (field === "emailApproved" && parsedVal !== true) {
      data.emailSentBy = null;
    }
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data,
    });

    // Marking technical evaluation "Yes" queues a follow-up mail 24 hours later
    // (n8n waits and sends). Never let the webhook fail the field save.
    if (field === "technicalEvaluation" && value === "Yes" && oldVal !== "Yes") {
      void import("@/lib/techEvaluationFollowup")
        .then(({ queueTechnicalEvaluationFollowup }) => queueTechnicalEvaluationFollowup(enquiryId))
        .catch((e) => console.warn("[tech-eval-followup] queue skipped:", e));
    }

    // Keep contractNo in sync when party name changes.
    if (field === "partyName" && typeof value === "string" && value.trim()) {
      try {
        const { syncSingleEnquiryContractNumbers } = await import("@/lib/syncEnquiryContractNumbers");
        await syncSingleEnquiryContractNumbers(enquiryId, value);
      } catch (e) {
        console.warn("[updateEnquiryFieldAction] partyName contractNo sync skipped:", e);
      }
    }

    // Recalculate costs of all items if an enquiry field affecting cost changed.
    // Skip recalculation when the enquiry is frozen (apm === "Yes" && offerPdfGeneratedAt set)
    // to keep rate/cost columns frozen after the one-time PDF.
    let updatedItems = null;
    if (["state", "paymentTerms", "inspection", "pbg"].includes(field)) {
      const frozenCheck = await prisma.enquiry.findUnique({
        where: { id: enquiryId },
        select: { apm: true, offerPdfGeneratedAt: true },
      });
      const { isEnquiryFrozen } = await import("@/lib/oneClickAccess");
      if (frozenCheck && isEnquiryFrozen(frozenCheck.apm, frozenCheck.offerPdfGeneratedAt)) {
        console.log(`[Server] updateEnquiryField skipped recalcEnquiryItems for frozen enquiry=${enquiryId}`);
      } else {
        updatedItems = await recalculateEnquiryItems(enquiryId);
      }
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

/**
 * Sends the docket's quotation email through the n8n Gmail webhook.
 *
 * Preconditions (enforced server-side): the docket is ticked (`emailApproved`),
 * has not been sent before (`emailSentBy` null), and has a recipient
 * (`senderEmail`). The Offer PDF is generated and attached; Cc comes from the
 * comma-separated `emailAddress`. On success the sent marker is persisted; on
 * any failure nothing is written and the error is returned to the client.
 *
 * The email is sent as a reply inside the linked `DocketQuotationThread` (the
 * latest thread whose `docketNo` matches this docket number) so it lands on the
 * RFQ conversation instead of starting a new one. When no linked thread exists
 * the action returns `code: "NO_THREAD"` and sends nothing — unless the caller
 * passes `allowNoThread`, which sends it as a plain new email instead.
 */
export async function sendDocketEmailAction(
  enquiryId: string,
  allowNoThread = false,
  revised = false,
) {
  await requireAccess();
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!session?.user) {
      return { success: false, error: "You must be logged in to send this email." };
    }
    const userId = (session.user as any).id ?? (session.user as any).email ?? "unknown";

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!enquiry) return { success: false, error: "Docket not found." };
    if (!enquiry.emailApproved) {
      return { success: false, error: "Approve this docket (tick) before sending." };
    }
    if (enquiry.emailSentBy) {
      return { success: false, error: "This docket email has already been sent." };
    }
    const to = (enquiry.senderEmail || "").trim();
    if (!to || isBlockedPartyEmail(to)) {
      return { success: false, error: "No recipient (sender email) on this docket." };
    }

    // The quotation should go back as a reply in the thread the RFQ arrived on.
    // Resolve the latest thread linked to this docket number. When there is
    // none, refuse (code NO_THREAD) unless the caller opted into a plain new
    // email via allowNoThread.
    const { findLatestLinkedThread } = await import("@/lib/docketThreadResolver");
    const linkedThread = await findLatestLinkedThread(enquiry.docketNumber);
    if (!linkedThread && !allowNoThread) {
      return {
        success: false,
        error: "Linked email thread not found",
        // Lets the client offer "send as a new mail" instead of failing.
        code: "NO_THREAD" as const,
      };
    }

    // Always Cc the fixed address, merged with the docket's other emails and
    // de-duplicated case-insensitively. Blocked addresses are dropped and the
    // party's mandatory Cc is (re)added.
    const ccEmails = mergeMandatoryCc(
      enquiry.partyName,
      (enquiry.emailAddress || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    );
    if (!ccEmails.some((e) => e.toLowerCase() === DOCKET_EMAIL_ALWAYS_CC)) {
      ccEmails.push(DOCKET_EMAIL_ALWAYS_CC);
    }
    const cc = ccEmails.join(", ");

    // Reuse the Offer PDF pipeline for the attachment.
    const { generateOfferPdfAction } = await import("@/lib/generate-offer-pdf");
    const pdfRes = await generateOfferPdfAction(
      { docketNo: enquiry.docketNumber } as unknown as OfferLetterTemplateData,
      enquiryId,
      { bypassFreeze: true },
    );
    if (!pdfRes.success || !pdfRes.pdfBase64) {
      return { success: false, error: pdfRes.error || "Failed to generate the offer PDF." };
    }
    const pdfBuffer = Buffer.from(pdfRes.pdfBase64, "base64");

    // Project sentence source: project reference, else utility, else state.
    const projectName =
      (enquiry.projectReference || "").trim() ||
      (enquiry.utility || "").trim() ||
      (enquiry.state || "").trim();

    // One item is named in the mail; several point at the attached BOQ rather
    // than re-listing every line the Offer PDF already carries.
    const itemsClause = buildItemsClause(
      enquiry.items.map((item) => item.itemNameMerge || item.itemName || ""),
    );

    const deliverySchedule =
      (enquiry.items.find((i) => (i.deliverySchedule || "").trim())?.deliverySchedule || "").trim() ||
      "READY STOCK";

    const state = (enquiry.state || "").trim();
    const subject = buildDocketEmailSubject({ docketNumber: enquiry.docketNumber, revised });
    const html = buildDocketEmailHtml({
      docketNumber: enquiry.docketNumber,
      revised,
      projectName,
      itemsClause,
      paymentTerms: enquiry.paymentTerms || "",
      freight: `F.O.R. Site${state ? ` (${state})` : ""}`,
      deliverySchedule,
      pdfUrl: pdfRes.driveUrl ?? "",
      fileName: pdfRes.fileName || `${enquiry.docketNumber}.pdf`,
    });

    const send = await sendDocketEmailViaN8n({
      to,
      cc,
      subject,
      html,
      docketNumber: enquiry.docketNumber,
      fileName: pdfRes.fileName || `${enquiry.docketNumber}.pdf`,
      pdfBuffer,
      threadId: linkedThread?.threadId,
    });
    if (!send.success) {
      return { success: false, error: send.error || "Email sending failed." };
    }

    const updated = await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { emailSentBy: userId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    return { success: true, data: serializeEnquiry(updated) };
  } catch (error: any) {
    console.error("Error sending docket email:", error);
    return { success: false, error: error.message || "Failed to send the docket email." };
  }
}

/**
 * Syncs the Email Address column for every enquiry by matching docket number
 * against docket_quotation_threads (sender / to_details / cc_details) and
 * extracting external party email addresses.
 *
 * Fill-blanks-only: existing values (manual or previously synced) are never
 * overwritten, so repeated runs are idempotent and safe.
 */
export async function syncEnquiryEmailAddressesAction() {
  await requireAccess();
  try {
    const result = await syncEnquiryEmailAddresses({ onlyBlank: true, dryRun: false });
    console.log(
      `[Server] syncEnquiryEmailAddresses scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} matchedByParty=${result.matchedByParty}`
    );
    return {
      success: true as const,
      data: {
        scanned: result.scanned,
        updated: result.updated,
        skipped: result.skipped,
        threadCount: result.threadCount,
        partyCount: result.partyCount,
        matchedByParty: result.matchedByParty,
        enquiries: result.proposals.map((p) => ({ id: p.id, senderEmail: p.senderEmail, emailAddress: p.emailAddress })),
      },
    };
  } catch (error: any) {
    console.error("Error syncing enquiry email addresses:", error);
    return { success: false as const, error: error.message || "Failed to sync email addresses." };
  }
}

// ============================================================================
// LEGACY — superseded by the hourly `docket-creation` scheduler job.
// Source of truth: schedular_function/docket-creation.ts (+ run-docket-creation.ts,
// app/api/scheduler/docket-creation/route.ts). The manual "Create Pending
// Dockets" buttons were removed from EnquiryTable and the docket-follow-up page.
// Kept commented for reference. To re-enable, uncomment this block AND the
// matching imports near the top of this file.
// ============================================================================
//
// export interface PendingDocketCreated {
//   docketNumber: string;
//   partyName: string;
//   threadId: string;
//   source: "email" | "partyName" | "subCategory" | "unknown";
// }
//
// /**
//  * Materializes dockets for `DocketQuotationThread` rows flagged
//  * `pendingDocket = true`. For each thread it creates a header-only `Enquiry`
//  * (no items) with an auto-generated docket number, resolving the party name by
//  * matching the thread's external emails against previous dockets (falling back
//  * to the thread's `sub_category`, then "Unknown"), then stamps the thread with
//  * the new docket number and clears `pendingDocket`.
//  *
//  * Manual trigger only. Idempotent: a stamped thread leaves the pending set.
//  */
// export async function createPendingDocketsAction(options?: { dryRun?: boolean }) {
//   try {
//     const dryRun = options?.dryRun ?? false;
//
//     const pending = await prisma.docketQuotationThread.findMany({
//       where: { pendingDocket: true, docketNo: null },
//       orderBy: { date: "asc" },
//       select: {
//         id: true,
//         threadId: true,
//         subCategory: true,
//         partyName: true,
//         sender: true,
//         toDetails: true,
//         ccDetails: true,
//         date: true,
//         subject: true,
//         body: true,
//         bodyPreview: true,
//         attachNames: true,
//         attachLinks: true,
//       },
//     });
//
//     if (pending.length === 0) {
//       return { success: true as const, data: { created: 0, skipped: 0, dryRun, dockets: [] as PendingDocketCreated[] } };
//     }
//
//     const fiscalPrefix = getFiscalPrefix(new Date());
//     const [enquiries, assignedThreads, fiscalRows] = await Promise.all([
//       prisma.enquiry.findMany({ select: { emailAddress: true, partyName: true } }),
//       prisma.docketQuotationThread.findMany({
//         where: { docketNo: { not: null } },
//         select: { subCategory: true, partyName: true, sender: true, toDetails: true, ccDetails: true },
//       }),
//       prisma.enquiry.findMany({
//         where: { docketNumber: { startsWith: fiscalPrefix } },
//         select: { docketNumber: true },
//       }),
//     ]);
//
//     const emailPartyMap = buildEmailPartyMap({ enquiries, assignedThreads });
//     const docketNumbers = nextDocketSerials(
//       fiscalRows.map((r) => r.docketNumber),
//       pending.length,
//       new Date(),
//     );
//
//     const plan = pending.map((thread, index) => {
//       const resolved = resolvePartyForThread(thread, emailPartyMap);
//       return {
//         threadId: thread.threadId,
//         threadRowId: thread.id,
//         date: thread.date,
//         docketNumber: docketNumbers[index],
//         partyName: resolved.partyName,
//         source: resolved.source,
//         emailAddress: threadPreferredEmails(thread).join(", ") || null,
//         // Mail file attachments (linked as-is) + data for the snapshot PDF.
//         attachments: parseThreadAttachments(thread.attachNames, thread.attachLinks),
//         subject: thread.subject,
//         body: thread.body || thread.bodyPreview,
//         sender: thread.sender,
//         to: extractEmailsFromValue(thread.toDetails).join(", "),
//         cc: extractEmailsFromValue(thread.ccDetails).join(", "),
//       };
//     });
//
//     if (dryRun) {
//       return {
//         success: true as const,
//         data: {
//           created: plan.length,
//           skipped: 0,
//           dryRun,
//           dockets: plan.map((p) => ({
//             docketNumber: p.docketNumber,
//             partyName: p.partyName,
//             threadId: p.threadId,
//             source: p.source,
//           })) as PendingDocketCreated[],
//         },
//       };
//     }
//
//     const created: PendingDocketCreated[] = [];
//     for (const p of plan) {
//       try {
//         // Mail file attachments (linked as-is) + a generated snapshot PDF.
//         const attachmentRows: { name: string; url: string; type: string | null; size: number | null }[] =
//           p.attachments.map((a) => ({ name: a.name, url: a.url, type: a.type, size: null }));
//         try {
//           const snapshot = await buildSnapshotAttachment({
//             docketNumber: p.docketNumber,
//             partyName: p.partyName,
//             date: p.date ? p.date.toISOString() : null,
//             subject: p.subject,
//             sender: p.sender,
//             to: p.to,
//             cc: p.cc,
//             body: p.body,
//             attachments: p.attachments.map((a) => ({ name: a.name, url: a.url })),
//           });
//           attachmentRows.push({ name: snapshot.name, url: snapshot.url, type: snapshot.type, size: snapshot.size });
//         } catch (e) {
//           console.warn(`[createPendingDockets] snapshot failed for ${p.docketNumber}:`, e);
//         }
//
//         await prisma.$transaction([
//           prisma.enquiry.create({
//             data: {
//               docketNumber: p.docketNumber,
//               partyName: p.partyName,
//               enquiryDate: p.date ?? new Date(),
//               emailAddress: p.emailAddress,
//               attachments: { create: attachmentRows },
//             },
//           }),
//           prisma.docketQuotationThread.update({
//             where: { id: p.threadRowId },
//             data: { docketNo: p.docketNumber, pendingDocket: false },
//           }),
//         ]);
//         created.push({
//           docketNumber: p.docketNumber,
//           partyName: p.partyName,
//           threadId: p.threadId,
//           source: p.source,
//         });
//       } catch (e) {
//         console.error(`[createPendingDockets] failed for thread ${p.threadId}:`, e);
//       }
//     }
//
//     console.log(
//       `[createPendingDockets] pending=${pending.length} created=${created.length} skipped=${plan.length - created.length}`,
//     );
//
//     return {
//       success: true as const,
//       data: { created: created.length, skipped: plan.length - created.length, dryRun, dockets: created },
//     };
//   } catch (error: unknown) {
//     console.error("Error creating pending dockets:", error);
//     const message = error instanceof Error ? error.message : "Failed to create pending dockets.";
//     return { success: false as const, error: message };
//   }
// }
