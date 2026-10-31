"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { formatLakh } from "@/lib/debtorsAgeing";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import { fiscalMonths, type SaleLine } from "@/lib/executionPages";
import { TD, TDN, TH, Tile } from "./ui";

const GROUPS = [
  ["party", "Party"],
  ["valveType", "Valve type"],
  ["size", "Size"],
  ["pressureClass", "Pressure class"],
] as const;
type GroupKey = (typeof GROUPS)[number][0];

const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export default function SalesRegisterTable({ fy, years, lines }: { fy: string; years: string[]; lines: SaleLine[] }) {
  const router = useRouter();
  const [group, setGroup] = useState<GroupKey>("party");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string | null>(null);
  const months = useMemo(() => fiscalMonths(fy), [fy]);

  const filtered = useMemo(() => {
    const needle = squish(search);
    return lines.filter((l) => !needle || squish(`${l.party} ${l.invoiceNo} ${l.valveType} ${l.size} ${l.pressureClass}`).includes(needle));
  }, [lines, search]);

  const rows = useMemo(() => {
    type Row = { key: string; byMonth: Record<string, number>; total: number };
    const m = new Map<string, Row>();
    for (const l of filtered) {
      if (month && l.month !== month) continue;
      const k = l[group];
      const r: Row = m.get(k) ?? { key: k, byMonth: {}, total: 0 };
      if (l.month) r.byMonth[l.month] = (r.byMonth[l.month] ?? 0) + l.value;
      r.total += l.value;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [filtered, group, month]);

  const monthTotals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const l of filtered) if (l.month) t[l.month] = (t[l.month] ?? 0) + l.value;
    return t;
  }, [filtered]);

  const total = lines.reduce((s, l) => s + l.value, 0);
  const label = GROUPS.find(([k]) => k === group)![1];
  const visibleMonths = month ? [month] : months;

  const exportCsv = () =>
    downloadCsv(`sales_register_${fy}_${group}.csv`, toCsv(
      [label, ...visibleMonths.map(monthLabel), "Total"],
      rows.map((r) => [r.key, ...visibleMonths.map((m) => r.byMonth[m] ?? 0), r.total]),
    ));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={`Sales FY ${fy}`} value={formatLakh(total)} hint="Sum of invoice line values for the year" />
        <Tile label="Invoices" value={String(new Set(lines.map((l) => l.invoiceNo)).size)} />
        <Tile label="Parties" value={String(new Set(lines.map((l) => l.party)).size)} />
        <Tile label="Undated lines" value={String(lines.filter((l) => !l.month).length)} hint="Lines with no readable invoice date: counted in totals, not in any month" />
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Month-wise sales by</h2>
          <select className="rounded border border-border bg-background px-2 py-1 text-xs" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="rounded border border-border bg-background px-2 py-1 text-xs" value={fy} onChange={(e) => router.push(`?fy=${e.target.value}`)} aria-label="Financial year">
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
          {month && <button type="button" className="text-xs text-primary underline" onClick={() => setMonth(null)}>Clear month: {monthLabel(month)}</button>}
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={exportCsv}>Download Excel (CSV)</button>
          <div className="ml-auto w-72"><DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search party, invoice, valve" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/80">
              <tr>
                <th className={TH}>{label}</th>
                {visibleMonths.map((m) => (
                  <th key={m} className={`${TH} cursor-pointer text-right hover:text-primary`} title="Click to show only this month" onClick={() => setMonth(month === m ? null : m)}>{monthLabel(m)}</th>
                ))}
                <th className={`${TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <tr className="bg-muted/30 font-semibold">
                <td className={TD}>All</td>
                {visibleMonths.map((m) => <td key={m} className={TDN}>{monthTotals[m] ? formatLakh(monthTotals[m]) : "-"}</td>)}
                <td className={TDN}>{formatLakh(rows.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-muted/40">
                  <td className={`${TD} font-medium`}>{r.key}</td>
                  {visibleMonths.map((m) => <td key={m} className={TDN}>{r.byMonth[m] ? formatLakh(r.byMonth[m]) : "-"}</td>)}
                  <td className={TDN}>{formatLakh(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={visibleMonths.length + 2} className="py-12 text-center text-sm text-muted-foreground">No sales for this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
