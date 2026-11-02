import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { checkReport, type ReportData } from "@/lib/inspectionReport";

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
  const offers = await prisma.inspectionOffer.findMany({
    where: q
      ? {
          OR: [
            { vrno: { contains: q, mode: "insensitive" } },
            { contractVrno: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { report: { select: { id: true, status: true, data: true } } },
  });

  return (
    <main className="h-[calc(100vh-64px)] overflow-auto bg-background p-3">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Inspection Reports</h1>
        <form className="ml-auto">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search offer / MC no."
            className="h-8 rounded-md border border-slate-300 px-2 text-sm"
          />
        </form>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-100 text-left">
          <tr>
            {["Offer no.", "Offer date", "MC no.", "Client code", "Lines", "Report", "Checks"].map((h) => (
              <th key={h} className="border-b border-slate-200 px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const checks = o.report ? checkReport(o.report.data as ReportData) : [];
            const passed = checks.filter((c) => c.ok).length;
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
                <td className="px-2 py-1">{o.accCode}</td>
                <td className="px-2 py-1">{Array.isArray(o.lines) ? o.lines.length : 0}</td>
                <td className="px-2 py-1">{o.report?.status ?? "—"}</td>
                <td className={`px-2 py-1 ${passed === checks.length ? "text-green-700" : "text-red-700"}`}>
                  {o.report ? `${passed}/${checks.length}` : "—"}
                </td>
              </tr>
            );
          })}
          {offers.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-6 text-center text-slate-500">
                No inspection offers synced yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
