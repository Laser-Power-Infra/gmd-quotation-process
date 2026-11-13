import Link from "next/link";
import type { Metadata } from "next";
import { sortRows } from "@gmd/dashboard/lib/tableSort";
import { SortTh } from "@gmd/ui/components/plain-table";
import type { TableSort } from "@gmd/ui/components/data-table/types";
import { prisma } from "@/lib/prisma";
import {
  REPORT_STATUSES,
  checkReport,
  parseReportDate,
  reportMatches,
  serialSummary,
  teamLines,
  type ReportData,
  type ReportStatus,
} from "@/lib/inspectionReport";

export const metadata: Metadata = {
  title: "Inspection Reports | GMD One Person Lead Framework",
  description: "Inspection offers synced from the ERP dump, each with an auto-drafted report.",
};

// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

const TH = "border-b border-slate-200 px-2 py-1.5 font-medium";
// Sort key per column (null = not sortable).
const COLS = [
  ["vrno", "Offer no."],
  ["vrDate", "Offer date"],
  ["contractVrno", "MC no."],
  ["contractNo", "Contract no."],
  ["accCode", "Client code"],
  ["lines", "Lines"],
  [null, "Serial nos."],
  [null, "Inspecting team"],
  ["status", "Report"],
  ["checks", "Checks"],
] as const;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  // URL values are only used when they name a known status / column.
  const status = REPORT_STATUSES.find((s) => s === sp.status);
  const sortKey = COLS.find(([k]) => k && k === sp.sort)?.[0];
  const sort: TableSort | null = sortKey ? { key: sortKey, dir: sp.dir === "desc" ? "desc" : "asc" } : null;
  const url = (p: Record<string, string | undefined>) =>
    `/inspection_reports?${new URLSearchParams(Object.entries({ q, status, sort: sort?.key, dir: sort?.dir, ...p }).filter((e): e is [string, string] => !!e[1]))}`;

  const where = status ? { report: { status } } : undefined;
  const all = await prisma.inspectionOffer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    // shortcut: a search or a sort loads every offer and filters / sorts here, as serials are ranges inside the report JSON and offer dates are text; move to jsonb SQL if offers reach the tens of thousands.
    take: q || sort ? undefined : 500,
    include: { report: { select: { id: true, status: true, data: true } } },
  });
  const needle = q.toUpperCase();
  const matched = q
    ? all.filter(
        (o) =>
          [o.vrno, o.contractVrno].some((v) => v?.toUpperCase().includes(needle)) ||
          (o.report && reportMatches(o.report.data as ReportData, q)),
      )
    : all;
  // Share of checks passed, worked out only when sorting by it (checkReport is the costly part).
  const passRate = new Map<string, number | null>(
    sort?.key === "checks"
      ? matched.map((o) => {
          const checks = o.report ? checkReport(o.report.data as ReportData) : [];
          return [o.id, checks.length ? checks.filter((c) => c.ok).length / checks.length : null];
        })
      : [],
  );
  const offers = sortRows(matched, sort, (o, k) => {
    if (k === "vrDate") return parseReportDate(o.vrDate ?? "");
    if (k === "contractNo") return (o.report?.data as ReportData | undefined)?.header.contractNo;
    if (k === "lines") return Array.isArray(o.lines) ? o.lines.length : 0;
    if (k === "status") return o.report ? REPORT_STATUSES.indexOf(o.report.status as ReportStatus) : null;
    if (k === "checks") return passRate.get(o.id);
    return o[k as "vrno" | "contractVrno" | "accCode"];
  }).slice(0, 500);
  // A search or sort holds every match already; otherwise only the first 500 were loaded, so count the rest.
  const total = q || sort || all.length < 500 ? matched.length : await prisma.inspectionOffer.count({ where });

  return (
    <main className="h-[calc(100vh-64px)] overflow-auto bg-background p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Inspection Reports</h1>
        <nav aria-label="Report status" className="flex flex-wrap items-center gap-1 text-xs">
          {[undefined, ...REPORT_STATUSES].map((s) => (
            <Link
              key={s ?? "all"}
              href={url({ status: s })}
              aria-current={s === status ? "true" : undefined}
              className={`rounded border px-2 py-1 ${s === status ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`}
            >
              {s ?? "All"}
            </Link>
          ))}
        </nav>
        {total > offers.length && (
          <span className="text-xs text-muted-foreground">
            Showing {offers.length} of {total}
          </span>
        )}
        <form className="ml-auto">
          {status && <input type="hidden" name="status" value={status} />}
          {sort && <input type="hidden" name="sort" value={sort.key} />}
          {sort && <input type="hidden" name="dir" value={sort.dir} />}
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
            {COLS.map(([k, h]) =>
              k ? (
                <SortTh key={k} k={k} label={h} sort={sort} href={(next) => url({ sort: next?.key, dir: next?.dir })} linkAs={Link} className={TH} />
              ) : (
                <th key={h} className={TH}>
                  {h}
                </th>
              ),
            )}
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
                {q || status ? "No matching offers." : "No inspection offers synced yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
