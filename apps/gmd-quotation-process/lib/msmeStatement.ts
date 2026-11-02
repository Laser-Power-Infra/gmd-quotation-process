/** MSME interest statement / notice per client, as HTML for the PDF renderer. Pure: no Prisma or puppeteer import. */
import { escapeHtml } from "./docketSnapshot";
import { formatIndianNumber } from "./formatCurrency";
import { UDYAM_CATEGORY, UDYAM_NO } from "./msme";
import type { MsmeBill, MsmeSettings } from "./msme";

export type InterestStatementData = { accCode: string; accName: string | null; bills: MsmeBill[]; settings: MsmeSettings; today: Date };

const d = (v: Date | string) => new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const inr = (n: number) => `₹ ${formatIndianNumber(n, 2)}`;

export function buildInterestStatementHtml(x: InterestStatementData): string {
  const rate = 3 * x.settings.bankRatePct;
  const principal = x.bills.reduce((t, b) => t + b.bal, 0);
  const interest = x.bills.reduce((t, b) => t + b.interest, 0);
  const rows = x.bills
    .map(
      (b) =>
        `<tr><td>${escapeHtml(b.vrNo ?? "")}</td><td>${d(b.vrDate)}</td><td class="n">${inr(b.bal)}</td><td>${d(b.msmeDue)}</td><td class="n">${Math.max(0, b.daysPastDue)}</td><td class="n">${inr(b.interest)}</td><td class="n">${inr(b.bal + b.interest)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;font-size:12px;color:#222}h1{font-size:16px;margin:0 0 4px}h2{font-size:13px;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.n{text-align:right}tfoot td{font-weight:bold}
</style></head><body>
<h1>G.M. Dalui &amp; Sons Pvt. Ltd.</h1>
<div>MSME Udyam Registration No. ${UDYAM_NO} (${UDYAM_CATEGORY})</div>
<h2>Statement of MSME interest and notice for payment</h2>
<div>Date: ${d(x.today)}</div>
<div>To: <b>${escapeHtml(x.accName ?? x.accCode)}</b> (${escapeHtml(x.accCode)})</div>
<table><thead><tr><th>Bill no.</th><th>Bill date</th><th class="n">Outstanding</th><th>MSME due date</th><th class="n">Days past due</th><th class="n">Interest @ ${rate.toFixed(2)}% p.a.</th><th class="n">Total claimable</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">Total</td><td class="n">${inr(principal)}</td><td></td><td></td><td class="n">${inr(interest)}</td><td class="n">${inr(principal + interest)}</td></tr></tfoot></table>
<p>We are a registered ${UDYAM_CATEGORY} enterprise under the Micro, Small and Medium Enterprises Development Act, 2006 (Udyam Registration No. ${UDYAM_NO}).
Under Section 15 of the Act, payment is due within the agreed credit period, not exceeding 45 days from acceptance (15 days where no period is agreed in writing).
Under Section 16, any amount paid late carries compound interest with monthly rests at three times the bank rate notified by the Reserve Bank of India
(bank rate ${x.settings.bankRatePct}%, i.e. ${rate.toFixed(2)}% p.a.), calculated above in whole months from the MSME due date.
Under Section 43B(h) of the Income-tax Act, 1961, dues to a micro or small enterprise paid after 45 days are not allowed as a deduction to the buyer.</p>
<p>You are requested to pay the principal and the interest shown above within 15 days of this notice, failing which we shall refer the matter to the
Micro and Small Enterprises Facilitation Council under Section 18 of the Act through the MSME Samadhaan portal.</p>
<p style="margin-top:28px">For G.M. Dalui &amp; Sons Pvt. Ltd.<br><br><br>Authorised Signatory</p>
</body></html>`;
}
