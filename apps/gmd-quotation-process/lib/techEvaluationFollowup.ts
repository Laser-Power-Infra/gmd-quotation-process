/**
 * Queues the 24-hour technical-evaluation follow-up when a docket is marked
 * "Yes". The waiting and the actual send live in the n8n workflow
 * (`GMD Quotation - Technical Evaluation Follow-up`); this only hands it the
 * ready-to-send mail.
 */

import { prisma } from "@/lib/prisma";
import { isBlockedPartyEmail, mergeMandatoryCc } from "@/lib/enquiryEmailParty";
import { DOCKET_EMAIL_ALWAYS_CC } from "@/lib/services/n8nEmail";
import { sendTechEvalFollowupViaN8n } from "@/lib/services/n8nTechEvalFollowup";
import {
  buildTechEvaluationFollowupHtml,
  buildTechEvaluationFollowupSubject,
} from "@/lib/techEvaluationFollowupTemplate";

export async function queueTechnicalEvaluationFollowup(enquiryId: string): Promise<void> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      docketNumber: true,
      partyName: true,
      enquiryDate: true,
      projectReference: true,
      utility: true,
      state: true,
      senderEmail: true,
      emailAddress: true,
      emailSentBy: true,
      technicalEvaluation: true,
    },
  });
  // Re-read guards against a Yes that was cleared while this call was in flight.
  if (!enquiry || enquiry.technicalEvaluation !== "Yes") return;

  // A follow-up only makes sense once the offer itself has gone out.
  if (!enquiry.emailSentBy) {
    console.log("[tech-eval-followup] skipped — offer not sent yet", { docketNumber: enquiry.docketNumber });
    return;
  }

  const to = (enquiry.senderEmail || "").trim();
  if (!to || isBlockedPartyEmail(to)) {
    console.log("[tech-eval-followup] skipped — no usable client email", { docketNumber: enquiry.docketNumber });
    return;
  }

  const cc = mergeMandatoryCc(
    enquiry.partyName,
    (enquiry.emailAddress || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
  );
  if (!cc.some((e) => e.toLowerCase() === DOCKET_EMAIL_ALWAYS_CC)) {
    cc.push(DOCKET_EMAIL_ALWAYS_CC);
  }

  const projectName =
    (enquiry.projectReference || "").trim() ||
    (enquiry.utility || "").trim() ||
    (enquiry.state || "").trim();

  const subject = buildTechEvaluationFollowupSubject({ docketNumber: enquiry.docketNumber });
  const html = buildTechEvaluationFollowupHtml({
    docketNumber: enquiry.docketNumber,
    projectName,
    offerDate: new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
  });

  await sendTechEvalFollowupViaN8n({
    docketNumber: enquiry.docketNumber,
    to,
    cc: cc.join(", "),
    subject,
    html,
    markedAt: new Date().toISOString(),
  });
}
