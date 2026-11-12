import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { checkReport, reportMatches, serialSummary, teamLines, type ReportData } from "@/lib/inspectionReport";

export const metadata: Metadata = {
  title: "Inspection Reports | GMD One Person Lead Framework",
  description: "Inspection offers synced from the ERP dump, each with an auto-drafted report.",
};

// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const all = await prisma.inspectionOffer.findMany({
    orderBy: { createdAt: "desc" },
    // shortcut: a search loads every offer and filters here, as serials are ranges inside the report JSON; move to a jsonb SQL filter if offers reach the tens of thousands.
    take: q ? undefined : 500,
    include: { report: { select: { id: true, status: true, data: true } } },
  });
  const needle = q.toUpperCase();
  const offers = q
    ? all
        .filter(
          (o) =>
            [o.vrno, o.contractVrno].some((v) => v?.toUpperCase().includes(needle)) ||
            (o.report && reportMatches(o.report.data as ReportData, q)),
        )
        .slice(0, 500)
    : all;

  return (
    <main className="h-[calc(100vh-64px)] overflow-auto bg-background p-3">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Inspection Reports</h1>
        <form className="ml-auto">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search offer / MC / contract / serial no."
            className="h-8 rounded-md border border-slate-300 px-2 text-sm"
          />
        </form>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-100 text-left">
          <tr>
            {[
              "Offer no.",
              "Offer date",
              "MC no.",
              "Contract no.",
              "Client code",
              "Lines",
              "Serial nos.",
              "Inspecting team",
              "Report",
              "Checks",
            ].map((h) => (
              <th key={h} className="border-b border-slate-200 px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const data = o.report?.data as ReportData | undefined;
            const checks = data ? checkReport(data) : [];
            const passed = checks.filter((c) => c.ok).length;
            const serials = data && serialSummary(data.items);
            return (
              <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1">
                  {o.report ? (
                    <Link href={`/inspection_reports/${o.report.id}`} className="text-blue-700 underline">
                      {o.vrno}
                    </Link>
                  ) : (
                    o.vrno
                  )}
                </td>
                <td className="px-2 py-1">{o.vrDate}</td>
                <td className="px-2 py-1">{o.contractVrno}</td>
                <td className="px-2 py-1">{data?.header.contractNo}</td>
                <td className="px-2 py-1">{o.accCode}</td>
                <td className="px-2 py-1">{Array.isArray(o.lines) ? o.lines.length : 0}</td>
                <td className="px-2 py-1">
                  {serials && (
                    <details>
                      <summary className="cursor-pointer">{serials.label}</summary>
                      {serials.ranges.map((r, i) => (
                        <div key={i}>{r}</div>
                      ))}
                    </details>
                  )}
                </td>
                <td className="px-2 py-1">
                  {teamLines(data?.team).map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                </td>
                <td className="px-2 py-1">{o.report?.status ?? "—"}</td>
                <td className={`px-2 py-1 ${passed === checks.length ? "text-green-700" : "text-red-700"}`}>
                  {o.report ? `${passed}/${checks.length}` : "—"}
                </td>
              </tr>
            );
          })}
          {offers.length === 0 && (
            <tr>
              <td colSpan={10} className="px-2 py-6 text-center text-slate-500">
                {q ? "No matching offers." : "No inspection offers synced yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
