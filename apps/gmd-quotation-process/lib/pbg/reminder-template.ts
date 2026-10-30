import { formatAmount, formatDate } from "@/lib/pbg/format";
import type { ReminderStage } from "@/lib/pbg/reminder-rules";

export type ReminderEmailRow = {
  bgNo: string | null;
  bgDate: string | null;
  bgAmtFc: number | null;
  expiryDate: string | null;
  poNumber: string | null;
  project: string | null;
  clientName: string | null;
  invoiceNos?: string[] | null;
};

export type ReminderEmailInput = {
  stage: ReminderStage;
  rows: ReminderEmailRow[];
  onExpiryDate?: boolean;
  partyName?: string | null;
  reminderNumber?: number | null;
  earlierMailDates?: string[] | null;
  udyamNo?: string | null;
};

export type ReminderEmail = {
  subject: string;
  html: string;
  text: string;
};

const COMPANY = "G.M. Dalui & Sons Pvt. Ltd.";
const ADDRESS_LINES = [
  "19th Floor, North Wing",
  "Salt Lake, Adventz Infinity",
  "Sector V, Kolkata",
  "West Bengal – 700091",
];
const UDYAM_PLACEHOLDER = "[UDYAM-XX-00-0000000]";

const PROVISIONS = [
  "Rule 171 of the General Financial Rules (GFR), 2017 – performance security is to remain valid only up to 60 days beyond the date of completion of all contractual obligations of the supplier, including warranty obligations. Our obligations are complete and this period is over, so the security is due to be returned.",
  "Micro, Small and Medium Enterprises Development (MSMED) Act, 2006 – Sections 15 & 16 – amounts due to a registered Micro/Small enterprise are to be released within the agreed period, not exceeding 45 days; delay attracts compound interest with monthly rests at three times the bank rate notified by RBI.",
  "Section 18 of the MSMED Act, 2006 – the MSE supplier may refer the matter to the Micro and Small Enterprises Facilitation Council (MSEFC), including through the MSME Samadhaan portal (samadhaan.msme.gov.in). Section 24 gives these provisions overriding effect.",
];

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function display(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : text;
}

function formatInvoiceList(values: string[] | null | undefined): string {
  const cleaned = Array.from(
    new Set(
      (values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  );
  return cleaned.length > 0 ? cleaned.join(", ") : "—";
}

function clientLabel(rows: ReminderEmailRow[]): string {
  const names = Array.from(
    new Set(
      rows
        .map((row) => String(row.clientName ?? "").trim())
        .filter((name) => name !== ""),
    ),
  );
  if (names.length === 1) return names[0];
  if (names.length > 1) return "PBG Portfolio";
  return "PBG Portfolio";
}

type PoSection = {
  poNumber: string | null;
  rows: ReminderEmailRow[];
};

function groupRowsByPo(rows: ReminderEmailRow[]): PoSection[] {
  const groups = new Map<string, PoSection>();
  for (const row of rows) {
    const key = String(row.poNumber ?? "").trim();
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { poNumber: row.poNumber, rows: [row] });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    String(a.poNumber ?? "").localeCompare(String(b.poNumber ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function sumAmount(rows: ReminderEmailRow[]): number | null {
  let total = 0;
  let found = false;
  for (const row of rows) {
    if (row.bgAmtFc !== null && row.bgAmtFc !== undefined) {
      total += row.bgAmtFc;
      found = true;
    }
  }
  return found ? total : null;
}

function uniqueExpiryDates(rows: ReminderEmailRow[]): string[] {
  return Array.from(
    new Set(rows.map((row) => String(row.expiryDate ?? "").trim()).filter(Boolean)),
  );
}

function expiryReference(rows: ReminderEmailRow[]): string {
  const dates = uniqueExpiryDates(rows);
  return dates.length === 1
    ? formatDate(dates[0])
    : "the respective dates shown in the table above";
}

function isPlural(rows: ReminderEmailRow[]): boolean {
  return rows.length > 1;
}

function poCount(rows: ReminderEmailRow[]): number {
  return new Set(rows.map((row) => String(row.poNumber ?? "").trim())).size;
}

function preExpiryBody(input: ReminderEmailInput): string {
  const plural = isPlural(input.rows);
  const multiplePos = poCount(input.rows) > 1;
  const orderWord = multiplePos ? "orders" : "order";
  const verb = multiplePos ? "are" : "is";
  const guarantee = plural
    ? "Performance Bank Guarantees"
    : "Performance Bank Guarantee";
  const dateRef = expiryReference(input.rows);

  return `This is to bring to your kind notice that the performance/guarantee period against the material supplied by us under the above ${orderWord} ${verb} going to expire on ${dateRef}. After ${
    uniqueExpiryDates(input.rows).length === 1 ? "this date" : "the above dates"
  }, no further complaints or issues against the supplied material can be attended to by us, as our contractual performance obligations will stand fulfilled. You are therefore requested to kindly arrange release of the above ${guarantee} on the expiry date and return the original BG to us (or send the discharge letter to the issuing bank). If there is any pending complaint against the supplied material, please inform us before ${dateRef} so that it can be attended to within the performance period. Kindly acknowledge receipt of this letter.`;
}

function expiryDayBody(input: ReminderEmailInput): string {
  const plural = isPlural(input.rows);
  const multiplePos = poCount(input.rows) > 1;
  const guarantee = plural
    ? "Performance Bank Guarantees"
    : "Performance Bank Guarantee";
  const hasExpired = plural ? "have expired" : "has expired";
  const guaranteeSubject = plural
    ? "The said bank guarantees are considered as closed."
    : "The said bank guarantee is considered as closed.";
  const orderWord = multiplePos ? "orders" : "order";
  const dates = uniqueExpiryDates(input.rows);
  const confirmation =
    dates.length === 1
      ? `This is to confirm that the above ${guarantee} ${hasExpired} today, ${formatDate(
          dates[0],
        )}.`
      : `This is to confirm that the above ${guarantee} ${hasExpired} today; the individual expiry dates are shown in the table above.`;

  return `${confirmation} With this, the performance period against the supplied material is complete and all our liabilities under the above ${orderWord} stand over. ${guaranteeSubject} You are requested to kindly return the original BG / issue the discharge letter at the earliest so that we can close it with our bank. Thank you for your cooperation.`;
}

function intervalReminderLine(input: ReminderEmailInput): string {
  const reminderNumber =
    input.reminderNumber && input.reminderNumber > 0
      ? Math.floor(input.reminderNumber)
      : 1;
  const earlierDates = (input.earlierMailDates ?? [])
    .map((value) => formatDate(String(value ?? "").trim()))
    .filter((value) => value !== "—");
  const reference =
    earlierDates.length > 0
      ? `with reference to our letters dated ${earlierDates.join(", ")}`
      : "with reference to our earlier letters";
  return `This is reminder no. ${reminderNumber} ${reference}.`;
}

function intervalExpiryText(input: ReminderEmailInput): string {
  const plural = isPlural(input.rows);
  const guarantee = plural
    ? "Performance Bank Guarantees"
    : "Performance Bank Guarantee";
  const original = plural
    ? "original BGs / discharge letters"
    : "original BG / discharge letter";
  return `The above ${guarantee} expired on ${expiryReference(
    input.rows,
  )} and all our liabilities against the supplied material are over. However, the ${original} ${
    plural ? "have" : "has"
  } not been received back by us till date.`;
}

function intervalMsmeLine(input: ReminderEmailInput): string {
  const udyamNo =
    String(input.udyamNo ?? "").trim() || UDYAM_PLACEHOLDER;
  return `As we are a registered MSME (Udyam Registration No. ${udyamNo}) following are the Applicable provisions:`;
}

function intervalClosing(input: ReminderEmailInput): string {
  const plural = isPlural(input.rows);
  const original = plural
    ? "original BGs / discharge letters"
    : "original BG / discharge letter";
  return `We therefore request you to return the ${original} to the issuing bank within 7 days of this letter. In the absence of a response, we may be constrained to take up the matter with the MSEFC through the MSME Samadhaan portal, along with the bank charges incurred, without further reference to you. We look forward to your early action.`;
}

function intervalBodyHtml(input: ReminderEmailInput): string {
  const items = PROVISIONS.map(
    (provision) =>
      `<li style="margin:0 0 6px;">${escapeHtml(provision)}</li>`,
  ).join("");
  return `<p style="margin:0 0 12px;">${escapeHtml(
    intervalReminderLine(input),
  )}</p>
    <p style="margin:0 0 12px;">${escapeHtml(intervalExpiryText(input))}</p>
    <p style="margin:0 0 6px;">${escapeHtml(intervalMsmeLine(input))}</p>
    <ol style="margin:0 0 12px 20px;padding:0;">${items}</ol>
    <p style="margin:0;">${escapeHtml(intervalClosing(input))}</p>`;
}

function intervalBodyText(input: ReminderEmailInput): string {
  const provisions = PROVISIONS.map(
    (provision, index) => `${index + 1}. ${provision}`,
  ).join("\n");
  return `${intervalReminderLine(input)}\n\n${intervalExpiryText(
    input,
  )}\n\n${intervalMsmeLine(input)}\n${provisions}\n\n${intervalClosing(
    input,
  )}`;
}

function bodyHtml(input: ReminderEmailInput): string {
  if (input.stage === "BEFORE_30_DAYS") {
    return `<p style="margin:0;">${escapeHtml(preExpiryBody(input))}</p>`;
  }
  if (input.onExpiryDate) {
    return `<p style="margin:0;">${escapeHtml(expiryDayBody(input))}</p>`;
  }
  return intervalBodyHtml(input);
}

function bodyText(input: ReminderEmailInput): string {
  if (input.stage === "BEFORE_30_DAYS") {
    return preExpiryBody(input);
  }
  if (input.onExpiryDate) {
    return expiryDayBody(input);
  }
  return intervalBodyText(input);
}

function buildSubject(input: ReminderEmailInput): string {
  const party = String(
    input.partyName ?? clientLabel(input.rows) ?? "",
  ).trim();
  const partyPart = party ? ` – ${party}` : "";
  const firstRow = input.rows[0];

  if (input.stage === "BEFORE_30_DAYS") {
    if (input.rows.length === 1) {
      return `Reminder: PBG expiring on ${formatDate(
        firstRow?.expiryDate ?? null,
      )}${partyPart} | ${COMPANY}`;
    }
    return `Reminder: PBGs expiring within 30 days${partyPart} | ${COMPANY}`;
  }

  if (input.onExpiryDate) {
    return `Reminder: PBG expiring today${partyPart} | ${COMPANY}`;
  }

  if (!party && input.rows.length === 1 && firstRow?.bgNo) {
    return `Reminder: Expired PBG return request – ${firstRow.bgNo} | ${COMPANY}`;
  }

  return `Reminder: Expired PBG return request${partyPart} | ${COMPANY}`;
}

const TH_STYLE =
  "padding:10px 12px;border:1px solid #cbd5e1;background:#0f172a;color:#ffffff;text-align:left;font-size:12px;font-weight:700;letter-spacing:0.02em;";
const TD_STYLE =
  "padding:9px 12px;border:1px solid #e2e8f0;color:#1f2937;font-size:12px;vertical-align:top;";
const TD_RIGHT_STYLE = `${TD_STYLE}text-align:right;white-space:nowrap;`;
const TD_NOWRAP_STYLE = `${TD_STYLE}white-space:nowrap;`;

function buildHtmlTable(section: PoSection): string {
  const total = sumAmount(section.rows);
  const rows = section.rows
    .map(
      (row) => `<tr>
        <td style="${TD_STYLE}">${escapeHtml(display(row.project))}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(display(row.bgNo))}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(formatDate(row.bgDate))}</td>
        <td style="${TD_RIGHT_STYLE}">${escapeHtml(formatAmount(row.bgAmtFc))}</td>
        <td style="${TD_NOWRAP_STYLE}">${escapeHtml(formatDate(row.expiryDate))}</td>
        <td style="${TD_STYLE}">${escapeHtml(formatInvoiceList(row.invoiceNos))}</td>
      </tr>`,
    )
    .join("");

  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:18px 0;font-family:Arial,Helvetica,sans-serif;">
    <thead>
      <tr>
        <th colspan="6" style="${TH_STYLE}">PO No: ${escapeHtml(
          display(section.poNumber),
        )}</th>
      </tr>
      <tr>
        <th style="${TH_STYLE}">Project</th>
        <th style="${TH_STYLE}">BG No</th>
        <th style="${TH_STYLE}">BG Date</th>
        <th style="${TH_STYLE}text-align:right;">BG Amt (FC)</th>
        <th style="${TH_STYLE}">Expiry Date</th>
        <th style="${TH_STYLE}">Invoice No</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="3" style="${TD_STYLE}text-align:right;font-weight:700;">PO Total</td>
        <td style="${TD_RIGHT_STYLE}font-weight:700;">${escapeHtml(
          formatAmount(total),
        )}</td>
        <td colspan="2" style="${TD_STYLE}"></td>
      </tr>
    </tbody>
  </table>`;
}

function buildHtml(input: ReminderEmailInput): string {
  const greeting = "Dear Sir/Madam,";
  const address = ADDRESS_LINES.map((line) => escapeHtml(line)).join("<br/>");
  const sections = groupRowsByPo(input.rows);
  const tables = sections.map(buildHtmlTable).join("");
  const grandTotal =
    sections.length > 1
      ? `<p style="margin:0 0 12px;text-align:right;"><strong>Grand Total: ${escapeHtml(
          formatAmount(sumAmount(input.rows)),
        )}</strong></p>`
      : "";

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px;line-height:1.55;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 20px;">
      <tr>
        <td style="padding:0 0 14px;border-bottom:2px solid #7a0c0c;">
          <img src="cid:gmd-logo" alt="G.M. Dalui &amp; Sons Pvt. Ltd." width="160" style="display:block;width:160px;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;">${greeting}</p>
    ${tables}
    ${grandTotal}
    ${bodyHtml(input)}
    <p style="margin:20px 0 12px;"><strong>${COMPANY}</strong><br/>${address}</p>
    <p style="margin:0;">Thanks &amp; Regards,<br/><strong>Ms. Puja Agarwal</strong><br/>Director<br/>${COMPANY}</p>
  </div>`;
}

function buildText(input: ReminderEmailInput): string {
  const greeting = "Dear Sir/Madam,";
  const sections = groupRowsByPo(input.rows);
  const lines: string[] = [greeting, ""];

  for (const section of sections) {
    lines.push(`PO No: ${display(section.poNumber)}`);
    for (const row of section.rows) {
      lines.push(
        `- Project: ${display(row.project)} | BG No: ${display(
          row.bgNo,
        )} | BG Date: ${formatDate(row.bgDate)} | Amount: ${formatAmount(
          row.bgAmtFc,
        )} | Expiry: ${formatDate(row.expiryDate)} | Invoice No: ${formatInvoiceList(
          row.invoiceNos,
        )}`,
      );
    }
    lines.push(`PO Total: ${formatAmount(sumAmount(section.rows))}`, "");
  }

  if (sections.length > 1) {
    lines.push(`Grand Total: ${formatAmount(sumAmount(input.rows))}`, "");
  }

  lines.push(
    bodyText(input),
    "",
    COMPANY,
    ...ADDRESS_LINES,
    "",
    "Thanks & Regards,",
    "Ms. Puja Agarwal",
    "Director",
    COMPANY,
  );

  return lines.join("\n");
}

export function buildReminderEmail(input: ReminderEmailInput): ReminderEmail {
  if (input.rows.length === 0) {
    throw new Error("Cannot build a PBG reminder email with no rows.");
  }
  return {
    subject: buildSubject(input),
    html: buildHtml(input),
    text: buildText(input),
  };
}
