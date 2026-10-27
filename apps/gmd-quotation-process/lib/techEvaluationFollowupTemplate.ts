/**
 * HTML body for the technical-evaluation follow-up email sent through n8n.
 *
 * Kept dependency-free and table-based, like `docketEmailTemplate.ts`, so it can
 * run inside the `updateEnquiryFieldAction` server action.
 */

export interface TechEvaluationFollowupData {
  docketNumber: string;
  /** Project / reference shown in the opening sentence (optional). */
  projectName?: string;
  /** Offer date, already formatted for display (optional). */
  offerDate?: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTechEvaluationFollowupSubject(
  data: Pick<TechEvaluationFollowupData, "docketNumber">,
): string {
  return `Follow-up on Offer - ${data.docketNumber}`;
}

export function buildTechEvaluationFollowupHtml(data: TechEvaluationFollowupData): string {
  const docket = data.docketNumber;
  const project = (data.projectName ?? "").trim();
  const offerDate = (data.offerDate ?? "").trim();

  const reference = [
    `our offer <strong>${esc(docket)}</strong>`,
    offerDate ? `dated ${esc(offerDate)}` : "",
    project ? `for the ${esc(project)} project` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(buildTechEvaluationFollowupSubject(data))}</title>
</head>
<body style="margin:0; padding:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#222222;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr>
    <td align="left" valign="top" style="padding:24px 28px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">

        <tr>
          <td style="font-size:15px; line-height:1.7; color:#222222;">
            <p style="margin:0 0 16px 0;">Dear Sir,</p>
            <p style="margin:0 0 16px 0;">
              We refer to ${reference}.
            </p>
            <p style="margin:0 0 16px 0;">
              We would like to know the status of the technical evaluation of our offer. Please let us know if any
              clarification or further information is required from our side so that we can take this forward.
            </p>
            <p style="margin:0 0 20px 0; font-style:italic;">Please feel free to contact for any clarifications.</p>
          </td>
        </tr>

        <tr>
          <td style="padding-top:16px; border-top:1px solid #dddddd; font-size:15px; line-height:1.7; color:#222222;">
            <div>Thanks &amp; Regards,</div>
            <div style="font-weight:bold; padding-top:6px;">Puja Agarwal</div>
            <div>Director</div>
            <div>GM Dalui and sons Pvt Ltd.</div>
            <div style="font-size:14px; padding-top:2px;">+91 88200 44755</div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}
