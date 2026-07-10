"use server";

import fs from "fs";
import path from "path";
import { generateOfferLetterPdf } from "./generatePdf";
import { OfferLetterTemplateData } from "@/types/offer-lettter";

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

    const safeDocketName = rowData.docketNo.replace(/[^a-zA-Z0-9-_]/g, "_");
    const fileName = `Offer-${safeDocketName}.pdf`;

    // Generate PDF in memory (no filesystem write)
    const pdfBuffer = await generateOfferLetterPdf(templateSource, rowData, {});

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
