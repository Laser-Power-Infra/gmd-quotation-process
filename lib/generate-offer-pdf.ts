"use server";

import fs from "fs";
import path from "path";
import { generateOfferLetterPdf } from "./generatePdf";
import { OfferLetterTemplateData } from "@/types/offer-lettter";
import { uploadFileToDrive } from "./gdrive";

export async function generateOfferPdfAction(rowData: OfferLetterTemplateData) {
  try {
    // Load Handlebars template dynamically
    const templatePath = path.join(process.cwd(), "lib", "offer_letter.hbs");
    const templateSource = fs.readFileSync(templatePath, "utf-8");

    // Load and convert logo.jpg to base64 Data URL
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.jpg");
      console.log("PDF Generation: logoPath = ", logoPath, ", exists = ", fs.existsSync(logoPath));
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        rowData.logoDataUrl = `data:image/jpeg;base64,${logoBuffer.toString("base64")}`;
        console.log("PDF Generation: successfully set logoDataUrl. Length = ", rowData.logoDataUrl.length);
      } else {
        console.log("PDF Generation: logo.jpg NOT found at", logoPath);
      }
    } catch (e) {
      console.error("Failed to load logo.jpg for PDF:", e);
    }

    const cleanState = (rowData.state || "UNKNOWN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const cleanParty = (rowData.partyName || "PARTY").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const cleanDocket = (rowData.docketNo || "DOCKET").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const fileName = `${cleanState}_${cleanParty}_${cleanDocket}.pdf`.replace(/__+/g, "_");

    // Generate PDF in memory (no filesystem write)
    const pdfBuffer = await generateOfferLetterPdf(templateSource, rowData, {});

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
      docketNo: rowData.docketNo,
    };
  } catch (error: any) {
    console.error(`Error generating PDF for docket ${rowData.docketNo}:`, error);
    return {
      success: false,
      error: error.message || "Failed to generate PDF on server",
    };
  }
}
