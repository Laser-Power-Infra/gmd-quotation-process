"use server";

import { requireAccess, loginRequired } from "@/lib/access";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { buildOfferPdf } from "./offerPdf";

/** Manual "Generate PDF": always applies the APM one-time access. Only server code (docket email) may bypass it, via buildOfferPdf. */
export async function generateOfferPdfAction(rowData: OfferLetterTemplateData, enquiryId?: string) {
  await requireAccess();
  const denied = await loginRequired(); if (denied) return denied;
  return buildOfferPdf(rowData, enquiryId);
}
