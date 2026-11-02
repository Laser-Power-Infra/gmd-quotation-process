import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getFollowUps, getLegalCases, loadMsmeSettings } from "@/lib/debtors-server";
import { isUnderLitigation } from "@/lib/legalStatus";
import { outstanding } from "@/lib/debtorsAgeing";
import { buildInterestStatement, GMD_UDYAM_CATEGORY, GMD_UDYAM_NO } from "@/lib/msmeStatement";
import { formatIndianNumber } from "@/lib/formatCurrency";
import PrintButton from "@/components/debtors/PrintButton";

const d = (iso: string) => iso.split("-").reverse().join("-");
const money = (n: number) => `₹${formatIndianNumber(n, 2)}`;

/** Printable MSME interest statement / demand notice for one debtor; use the browser's Print / Save as PDF. */
export default async function InterestStatementPage({ searchParams }: { searchParams: Promise<{ accCode?: string }> }) {
  await requireAccess();
  const { accCode } = await searchParams;
  if (!accCode) notFound();
  const [records, followUps, legalCases, msme] = await Promise.all([
    prisma.debtor.findMany({ where: { accCode }, select: { accName: true, vrNo: true, vrDate: true, unAllocDr: true, unAllocCr: true } }),
    getFollowUps("debtor"),
    getLegalCases("debtor"),
    loadMsmeSettings(),
  ]);
  if (!records.length) notFound();
  // Litigating parties get no notice (same predicate as reminders and the follow-up ladder).
  if (isUnderLitigation(legalCases[accCode]?.status)) {
    return <main className="p-8 text-sm">No statement for this party: it is under litigation, so no reminders or notices are generated.</main>;
  }
  const f = followUps[accCode];
  const cd = f?.creditDays ? Number(f.creditDays) : null;
  const st = buildInterestStatement(
    records.map((r) => ({ billNo: r.vrNo ?? "-", vrDate: r.vrDate?.toISOString() ?? null, bal: outstanding({ unAllocDr: Number(r.unAllocDr ?? 0), unAllocCr: Number(r.unAllocCr ?? 0) }) })),
    cd !== null && Number.isFinite(cd) ? cd : null,
    msme,
    new Date(),
  );
  const today = new Date().toISOString().slice(0, 10);
  const th = "border border-gray-400 px-2 py-1 text-left";
  const td = "border border-gray-400 px-2 py-1";
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-sm text-black">
      <PrintButton />
      <h1 className="mt-4 text-lg font-bold">MSME Interest Statement / Demand Notice</h1>
      <p>Date: {d(today)}</p>
      <p className="mt-2">From: G.M. Dalui &amp; Sons Pvt. Ltd. (Udyam Regn. No. {GMD_UDYAM_NO}, Category: {GMD_UDYAM_CATEGORY})</p>
      <p>To: <b>{records[0].accName ?? accCode}</b> ({accCode})</p>
      <p className="mt-3">
        Under Sections 15 to 17 of the Micro, Small and Medium Enterprises Development Act, 2006, payment to a micro or small enterprise must be made within the agreed period (not beyond 45 days; 15 days where there is no written agreement). Section 16 provides compound interest with monthly rests at three times the RBI bank rate ({msme.bankRatePct}%, i.e. {(3 * msme.bankRatePct).toFixed(2)}% p.a.) on amounts unpaid beyond that period.
        {f?.samadhaanNo ? ` MSME Samadhaan reference: ${f.samadhaanNo}${f.samadhaanStatus ? ` (${f.samadhaanStatus})` : ""}.` : ""}
      </p>
      {st.lines.length === 0 ? (
        <p className="mt-4 font-semibold">No bills are overdue under the MSMED Act as on {d(today)}.</p>
      ) : (
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr>{["Bill no", "Bill date", "Due date (MSMED Act)", "Days overdue", "Principal", "Interest to date"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {st.lines.map((l) => (
              <tr key={l.billNo + l.billDate}>
                <td className={td}>{l.billNo}</td><td className={td}>{d(l.billDate)}</td><td className={td}>{d(l.dueDate)}</td>
                <td className={`${td} text-right`}>{l.daysOverdue}</td><td className={`${td} text-right`}>{money(l.principal)}</td><td className={`${td} text-right`}>{money(l.interest)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={td} colSpan={4}>Total</td><td className={`${td} text-right`}>{money(st.principal)}</td><td className={`${td} text-right`}>{money(st.interest)}</td>
            </tr>
            <tr className="font-bold"><td className={td} colSpan={5}>Total claimable (principal + interest)</td><td className={`${td} text-right`}>{money(st.total)}</td></tr>
          </tbody>
        </table>
      )}
      <p className="mt-4">Please arrange payment of the above immediately. Interest continues to accrue until payment. {/* shortcut: interest is computed in whole elapsed months on current balances; part-payment dates are not modelled, upgrade if a client disputes the figure. */}</p>
    </main>
  );
}
