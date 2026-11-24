"use server";

import { requireAccess, loginRequired } from "@/lib/access";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { buildOfferPdf } from "./offerPdf";

/** Manual "Generate PDF / Excel": a frozen docket refuses both formats; only the PDF (the party's file) uses up the APM one-time access. Only server code (docket email) may bypass it, via buildOfferPdf. */
export async function generateOfferPdfAction(rowData: OfferLetterTemplateData, enquiryId?: string, format?: "pdf" | "xlsx") {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  return buildOfferPdf(rowData, enquiryId, { format: format === "xlsx" ? "xlsx" : "pdf" });
}
