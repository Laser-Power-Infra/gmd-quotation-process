"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { Segmented } from "@gmd/ui/components/segmented";
import { formatLakh } from "@/lib/debtorsAgeing";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import { addLine, emptyCell, fiscalMonths, gpOf, type GpCell, type SaleLine } from "@/lib/executionPages";
import { TD, TDN, TH, Tile } from "./ui";

const GROUPS = [
  ["party", "Party"],
  ["valveType", "Valve type"],
  ["size", "Size"],
  ["pressureClass", "Pressure class"],
] as const;
type GroupKey = (typeof GROUPS)[number][0];

const VIEWS = [
  { value: "sales", label: "Sales" },
  { value: "cost", label: "Cost" },
  { value: "gp", label: "Gross Profit (₹)" },
  { value: "gpPct", label: "GP %" },
] as const;
type View = (typeof VIEWS)[number]["value"];

type Row = { key: string; byMonth: Record<string, GpCell>; total: GpCell };

const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const pct = (n: number) => `${n.toFixed(1)}%`;
const missingNote = (c: GpCell) => `${formatLakh(c.missingSales)} (${c.missingLines} lines)`;
const round = (n: number | null, places: number) => (n === null ? "" : Math.round(n * 10 ** places) / 10 ** places);

/** One cell in the chosen view; the hover note says how much of it has no cost, and the quoted GP. */
function Cell({ c, view }: { c: GpCell | undefined; view: View }) {
  if (!c?.lines) return <td className={TDN}>-</td>;
  const g = gpOf(c);
  // Red only on a GP % that is shown, and never by colour alone: the title says why.
  const red = view === "gpPct" && g.red && g.gpPct !== null;
  const title = [
    red ? `Below minimum VA% (min ${pct((c.minGp * 100) / c.costedSales)})` : "",
    c.missingLines ? `Cost missing: ${missingNote(c)}` : "",
    g.quotedGpPct === null ? "" : `Quoted GP: ${pct(g.quotedGpPct)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const text =
    view === "sales" ? formatLakh(c.sales)
    : g.gp === null ? "Cost missing"
    : view === "cost" ? formatLakh(c.cost)
    : view === "gp" ? formatLakh(g.gp)
    : g.gpPct === null ? "-" : pct(g.gpPct);
  return <td className={red ? `${TDN} font-semibold text-red-600` : TDN} title={title || undefined}>{text}</td>;
}

export default function SalesRegisterTable({ fy, years, lines }: { fy: string; years: string[]; lines: SaleLine[] }) {
  const router = useRouter();
  const [group, setGroup] = useState<GroupKey>("party");
  const [view, setView] = useState<View>("sales");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string | null>(null);
  const months = useMemo(() => fiscalMonths(fy), [fy]);

  const filtered = useMemo(() => {
    const needle = squish(search);
    return lines.filter((l) => !needle || squish(`${l.party} ${l.invoiceNo} ${l.valveType} ${l.size} ${l.pressureClass}`).includes(needle));
  }, [lines, search]);

  // The All row adds the same lines, so its GP % is weighted, never an average of the rows'.
  const { rows, all } = useMemo(() => {
    const m = new Map<string, Row>();
    const all: Row = { key: "All", byMonth: {}, total: emptyCell() };
    const add = (r: Row, l: SaleLine) => {
      if (l.month) addLine((r.byMonth[l.month] ??= emptyCell()), l);
      addLine(r.total, l);
    };
    for (const l of filtered) {
      if (month && l.month !== month) continue;
      const k = l[group];
      const r: Row = m.get(k) ?? { key: k, byMonth: {}, total: emptyCell() };
      add(r, l);
      add(all, l);
      m.set(k, r);
    }
    return { rows: [...m.values()].sort((a, b) => b.total.sales - a.total.sales), all };
  }, [filtered, group, month]);

  const total = lines.reduce((s, l) => s + l.value, 0);
  const label = GROUPS.find(([k]) => k === group)![1];
  const visibleMonths = month ? [month] : months;

  const exportCsv = () =>
    downloadCsv(`sales_register_${fy}_${group}.csv`, toCsv(
      [label, "Month", "Sales", "Cost", "GP ₹", "GP %", "Quoted GP %", "Cost missing ₹", "Cost missing lines"],
      [all, ...rows].flatMap((r) =>
        [...visibleMonths, null].map((m) => {
          const c = (m ? r.byMonth[m] : r.total) ?? emptyCell();
          const g = gpOf(c);
          return [r.key, m ? monthLabel(m) : "Total", round(c.sales, 2), round(g.gp === null ? null : c.cost, 2), round(g.gp, 2),
            round(g.gpPct, 1), round(g.quotedGpPct, 1), round(c.missingSales, 2), c.missingLines];
        }),
      ),
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
          <Segmented options={VIEWS} value={view} onChange={setView} label="Show" />
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
                {visibleMonths.map((m) => <Cell key={m} c={all.byMonth[m]} view={view} />)}
                <Cell c={all.total} view={view} />
              </tr>
              <tr className="text-xs text-muted-foreground">
                <td className={TD} title="Lines with no purchase or BOM cost: counted in Sales, left out of Cost, GP and GP %">Cost missing</td>
                {visibleMonths.map((m) => <td key={m} className={TDN}>{all.byMonth[m]?.missingLines ? missingNote(all.byMonth[m]) : "-"}</td>)}
                <td className={TDN}>{all.total.missingLines ? missingNote(all.total) : "-"}</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-muted/40">
                  <td className={`${TD} font-medium`}>{r.key}</td>
                  {visibleMonths.map((m) => <Cell key={m} c={r.byMonth[m]} view={view} />)}
                  <Cell c={r.total} view={view} />
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
