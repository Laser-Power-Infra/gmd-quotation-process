"use server";

import fs from "fs";
import path from "path";
import { generateOfferLetterPdf } from "./generatePdf";
import { OfferLetterTemplateData } from "@/types/offer-lettter";
import { uploadFileToDrive } from "./gdrive";
import { prisma } from "@/lib/prisma";
import { getItemNameMerge } from "./costCalculator";

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

    if (dbEnquiry) {
      const pbg = dbEnquiry.pbg;
      let months = 18;
      if (pbg && pbg !== "NA") {
        const match = pbg.match(/For\s+(\d+)\s+Months?/i);
        if (match) {
          months = parseInt(match[1], 10);
        }
      }

      const items = (dbEnquiry.items || []).map((item) => {
        const mergedName = getItemNameMerge(item) || item.itemNameMerge || "";
        return {
          itemName: item.itemName,
          partyItemName: mergedName,
          quantity: item.quantity ? Number(item.quantity) : 0,
          quotationRate: item.quotedRate ? parseFloat(item.quotedRate) : 0,
          quotedRateGst: item.quotedRateGst ? parseFloat(item.quotedRateGst) : 0,
          totalValue: item.totalValue ? parseFloat(item.totalValue) : 0,
          unit: "Nos." as const,
          deliverySchedule: item.deliverySchedule || "2-3 weeks",
        };
      });

      const totalItemwiseValue = items.reduce((sum, item) => sum + item.quantity * item.quotationRate, 0);

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
