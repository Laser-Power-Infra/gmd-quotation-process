"use server";

import fs from "fs";
import path from "path";
import { generateOfferLetterPdf } from "./generatePdf";
import { OfferLetterTemplateData } from "@/types/offer-lettter";
import { uploadFileToDrive } from "./gdrive";
import { prisma } from "@/lib/prisma";
import { getItemNameMerge } from "./costCalculator";
import { makeImageKey } from "./imageKey";
import { oneClickAccess } from "./oneClickAccess";

function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // Handles: https://drive.google.com/file/d/{id}/view , https://drive.google.com/open?id={id}, https://drive.google.com/uc?id={id}, webViewLink
    const u = new URL(url);
    const byPath = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (byPath) return byPath[1];
    const idParam = u.searchParams.get("id");
    if (idParam) return idParam;
  } catch {}
  // Fallback: treat whole string as id if it looks like a drive id (no slashes)
  if (url && !url.includes("/") && url.length >= 20) return url;
  return null;
}

export async function generateOfferPdfAction(rowData: OfferLetterTemplateData, enquiryId?: string) {
  try {
    let finalRowData: OfferLetterTemplateData = { ...rowData };

    let dbEnquiry = null;
    if (enquiryId) {
      dbEnquiry = await prisma.enquiry.findUnique({
        where: { id: enquiryId },
        include: { items: { orderBy: { position: "asc" } } },
      });
    }
    if (!dbEnquiry && rowData.docketNo) {
      dbEnquiry = await prisma.enquiry.findUnique({
        where: { docketNumber: rowData.docketNo },
        include: { items: { orderBy: { position: "asc" } } },
      });
    }

    // Apply oneClickAccess rules
    if (dbEnquiry) {
      const check = oneClickAccess((dbEnquiry as any).apm, (dbEnquiry as any).offerPdfGeneratedAt)
      if (!check.allowed) {
        return { success: false, error: check.reason }
      }
    }

    if (dbEnquiry) {
      const pbg = dbEnquiry.pbg;
      let months = 18;
      if (pbg && pbg !== "NA") {
        const match = pbg.match(/For\s+(\d+)\s+Months?/i);
        if (match) {
          months = parseInt(match[1], 10);
        }
      }

      // Build base items with itemType/operationType/rmType kept for image lookup (not exposed directly in template except via rowspan grouping)
      const rawItems = dbEnquiry.items || [];
      const baseItems = rawItems.map((item: any) => {
        const mergedName = getItemNameMerge(item) || item.itemNameMerge || "";
        const itemType = (item.itemType || "").trim();
        const operationType = (item.operationType || "").trim();
        const rmType = (item.rmType || "").trim();
        const hasKeyParts = !!(itemType && operationType && rmType);
        const imageKey = hasKeyParts ? makeImageKey(itemType, operationType, rmType) : `__no_key__${item.id}`;
        return {
          itemName: item.itemName,
          partyItemName: mergedName,
          quantity: item.quantity ? Number(item.quantity) : 0,
          quotationRate: item.quotedRate ? parseFloat(item.quotedRate) : 0,
          quotedRateGst: item.quotedRateGst ? parseFloat(item.quotedRateGst) : 0,
          totalValue: item.totalValue ? parseFloat(item.totalValue) : 0,
          unit: "Nos." as const,
          deliverySchedule: item.deliverySchedule || "2-3 weeks",
          // internal grouping key
          __imageKey: imageKey,
          __hasKeyParts: hasKeyParts,
        };
      });

      // Fetch manually uploaded images for the distinct keys present in this enquiry
      const distinctKeys = [...new Set(baseItems.filter((b: any) => b.__hasKeyParts).map((b: any) => b.__imageKey as string))];
      const imageByKey = new Map<string, string | null>();
      if (distinctKeys.length) {
        try {
          const genImages = await prisma.generatedImage.findMany({
            where: { imageKey: { in: distinctKeys } },
            select: { imageKey: true, driveFileId: true, url: true, status: true },
          });
          // Only consider uploaded images (manual uploads have driveFileId; status ready, but we accept any that has driveFileId or url)
          for (const g of genImages) {
            const hasUploadedImage = !!(g.driveFileId || g.url);
            if (!hasUploadedImage) {
              imageByKey.set(g.imageKey, null);
              continue;
            }
            const driveFileId = g.driveFileId || extractDriveFileId(g.url);
            if (!driveFileId) {
              imageByKey.set(g.imageKey, null);
              continue;
            }
            // Small thumbnail; public "anyone with link" files only
            const thumbUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w300`;
            try {
              const resp = await fetch(thumbUrl, { cache: "no-store" } as any);
              if (!resp.ok) {
                console.warn(`[PDF] thumbnail fetch failed for ${g.imageKey} id=${driveFileId} status=${resp.status}`);
                imageByKey.set(g.imageKey, null);
                continue;
              }
              const ct = resp.headers.get("content-type") || "image/jpeg";
              // Reject HTML (Drive viewer page) — indicates permission or wrong url
              if (ct.includes("text/html")) {
                console.warn(`[PDF] thumbnail returned HTML for ${g.imageKey} id=${driveFileId}`);
                imageByKey.set(g.imageKey, null);
                continue;
              }
              const buf = Buffer.from(await resp.arrayBuffer());
              const b64 = buf.toString("base64");
              const dataUrl = `data:${ct};base64,${b64}`;
              imageByKey.set(g.imageKey, dataUrl);
            } catch (e) {
              console.warn(`[PDF] thumbnail fetch error for ${g.imageKey} id=${driveFileId}:`, e);
              imageByKey.set(g.imageKey, null);
            }
          }
          // Ensure every distinct key has an entry (null if no uploaded image)
          for (const k of distinctKeys) if (!imageByKey.has(k)) imageByKey.set(k, null);
        } catch (e) {
          console.error("[PDF] failed to load generated images for enquiry", dbEnquiry.id, e);
          for (const k of distinctKeys) imageByKey.set(k, null);
        }
      }

      // Compute rowspan groups: consecutive rows sharing the same non-empty imageKey are merged.
      // Each group: first row gets rowspan = group length for BOTH name and image; continuation rows get 0 (skipped in template).
      const items: any[] = [];
      let idx = 0;
      while (idx < baseItems.length) {
        const curKey = baseItems[idx].__imageKey as string;
        const curHasParts = baseItems[idx].__hasKeyParts as boolean;
        let groupEnd = idx + 1;
        if (curHasParts) {
          while (groupEnd < baseItems.length && baseItems[groupEnd].__imageKey === curKey && baseItems[groupEnd].__hasKeyParts) {
            groupEnd++;
          }
        }
        const groupLen = groupEnd - idx;
        const groupImageDataUrl = curHasParts ? (imageByKey.get(curKey) ?? null) : null;
        for (let j = idx; j < groupEnd; j++) {
          const b = baseItems[j];
          const isFirst = j === idx;
          items.push({
            itemName: b.itemName,
            partyItemName: b.partyItemName,
            quantity: b.quantity,
            quotationRate: b.quotationRate,
            quotedRateGst: b.quotedRateGst,
            totalValue: b.totalValue,
            unit: b.unit,
            deliverySchedule: b.deliverySchedule,
            imageDataUrl: isFirst ? groupImageDataUrl : null,
            nameRowspan: isFirst ? groupLen : 0,
            imageRowspan: isFirst ? groupLen : 0,
          });
        }
        idx = groupEnd;
      }

      const totalItemwiseValue = items.reduce((sum: number, item: any) => sum + item.quantity * item.quotationRate, 0);

      finalRowData = {
        ...finalRowData,
        docketNo: dbEnquiry.docketNumber,
        state: dbEnquiry.state || "",
        partyName: dbEnquiry.partyName,
        subject: `Offer For Supply under @ ${dbEnquiry.utility || ""}`,
        price: "The Quoted prices are on Firm basis, valid for 60days.",
        paymentTerms: dbEnquiry.paymentTerms || "",
        inspection: dbEnquiry.inspection || "",
        warranty: `The warranty shall be valid as per the standard maintenance clause on our website and to the maximum period of ${months} months from the date of supply.`,
        approval: "It shall be in our scope",
        deliveryDestination: dbEnquiry.state || "",
        items,
        totalItemwiseValue,
      };
    }

    // Load Handlebars template dynamically
    const templatePath = path.join(process.cwd(), "lib", "offer_letter.hbs");
    const templateSource = fs.readFileSync(templatePath, "utf-8");

    // Load and convert logo.jpg to base64 Data URL
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      console.log("PDF Generation: logoPath = ", logoPath, ", exists = ", fs.existsSync(logoPath));
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        finalRowData.logoDataUrl = `data:image/jpeg;base64,${logoBuffer.toString("base64")}`;
        console.log("PDF Generation: successfully set logoDataUrl. Length = ", finalRowData.logoDataUrl.length);
      } else {
        console.log("PDF Generation: logo.jpg NOT found at", logoPath);
      }
    } catch (e) {
      console.error("Failed to load logo.jpg for PDF:", e);
    }

    const cleanState = (finalRowData.state || "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const cleanParty = (finalRowData.partyName || "PARTY").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const cleanDocket = (finalRowData.docketNo || "DOCKET").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const fileName = `${cleanState}_${cleanParty}_${cleanDocket}.pdf`.replace(/__+/g, "_");

    // Generate PDF in memory (no filesystem write)
    const pdfBuffer = await generateOfferLetterPdf(templateSource, finalRowData, {});

    // Upload generated PDF to Google Drive
    try {
      await uploadFileToDrive(fileName, "application/pdf", pdfBuffer.toString("base64"));
    } catch (e) {
      console.error("Failed to upload generated PDF to Google Drive:", e);
    }

    // If apm === "Yes", freeze after first successful generation (one-time)
    if (dbEnquiry && (dbEnquiry as any).apm === "Yes" && !(dbEnquiry as any).offerPdfGeneratedAt) {
      try {
        const { auth } = await import("@/auth")
        const session = await auth()
        const userId = (session?.user as any)?.id ?? null
        // Atomic update: only if still null (prevents double-click race)
        const updated = await prisma.enquiry.updateMany({
          where: { id: (dbEnquiry as any).id, offerPdfGeneratedAt: null },
          data: { offerPdfGeneratedAt: new Date(), offerPdfGeneratedBy: userId },
        })
        if (updated.count === 0) {
          // Another request already consumed the one-time access
          const fresh = await prisma.enquiry.findUnique({ where: { id: (dbEnquiry as any).id }, select: { offerPdfGeneratedAt: true } })
          if (fresh?.offerPdfGeneratedAt) {
            // PDF already generated concurrently; we still return success for this caller but freeze stands
          }
        }
      } catch (e) {
        console.error("Failed to freeze offer PDF one-time flag:", e)
      }
    }

    return {
      success: true,
      pdfBase64: pdfBuffer.toString("base64"),
      fileName,
      docketNo: finalRowData.docketNo,
    };
  } catch (error: any) {
    console.error(`Error generating PDF for docket ${rowData.docketNo}:`, error);
    return {
      success: false,
      error: error.message || "Failed to generate PDF on server",
    };
  }
}
