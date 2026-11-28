"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { Button } from "@gmd/ui/components/button";
import { Tile } from "@gmd/ui/components/plain-table";
import { Segmented } from "@gmd/ui/components/segmented";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { formatLakh } from "@gmd/ui/lib/format";
import {
  DIMS,
  VIEWS,
  currentFy,
  dimLabel,
  emptyCell,
  fiscalMonths,
  gpOf,
  monthLabel,
  pivotColumns,
  type DimKey,
  type GpCell,
  type SalesPageData,
  type SalesRegisterActions,
  type SalesRow,
  type View,
} from "../columns";
import {
  clearFilters,
  queryOf,
  selectSalesRegister,
  setColumnSearch,
  setFilter,
  setFy,
  setGroup,
  setPage,
  setPageSize,
  setSearch,
  setSort,
  setView,
} from "../state/tableSlice";

export interface SalesRegisterPageProps {
  actions: SalesRegisterActions;
}

// The All and Cost missing rows head every page: they add up every filtered line, not just this page's groups.
const ALL_ID = "__all";
const MISSING_ID = "__missing";
const SELECT =
  "h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30";

const pct = (n: number) => `${n.toFixed(1)}%`;
const missingNote = (c: GpCell) => `${formatLakh(c.missingSales)} (${c.missingLines} lines)`;
const round = (n: number | null, places: number) => (n === null ? "" : Math.round(n * 10 ** places) / 10 ** places);

/** One cell in the chosen view; the hover note says how much of it has no cost, and the quoted GP. */
function cell(r: SalesRow, key: string, view: View): ReactNode {
  const c = key === "total" ? r.total : r.byMonth[key];
  if (r.id === MISSING_ID) return c?.missingLines ? missingNote(c) : "-";
  if (!c?.lines) return "-";
  const g = gpOf(c);
  // Red only on a GP % that is shown, and never by colour alone: the title says why.
  const red = view === "gpPct" && g.red && g.gpPct !== null;
  const title = [
    red ? `Below minimum VA% (GP floor ${pct((c.minGp * 100) / c.costedSales)} of sales)` : "",
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
  return <span title={title || undefined} className={red ? "font-semibold text-red-600" : undefined}>{text}</span>;
}

/** Month-wise sales of one fiscal year by party, valve type, size or pressure class, one server page of groups at a time. */
export function SalesRegisterPage({ actions }: SalesRegisterPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectSalesRegister);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  // Group and view re-shape the same lines, so they reload at once; filters and the year wait for the debounce.
  const filterKey = JSON.stringify({ filters: query.filters, columnSearch: query.columnSearch, search: query.search, fy: state.fy });
  // A key's facet ignores that key's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), columnSearch: omit(query.columnSearch), search: query.search, fy: state.fy });
    },
    [query, state.fy],
  );

  const table = useServerTable<SalesPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load the Sales Register.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await actions.loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data } = table;
  const meta = data?.meta;
  const kpi = meta?.kpi;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const fy = state.fy || meta?.fy || currentFy();
  const years = useMemo(() => (meta?.years.includes(fy) ? meta.years : [fy, ...(meta?.years ?? [])]), [meta, fy]);
  const pickedMonths = state.filters.month;
  const months = useMemo(() => fiscalMonths(fy).filter((m) => !pickedMonths?.length || pickedMonths.includes(m)), [fy, pickedMonths]);
  const columns = useMemo<DataColumn<SalesRow>[]>(
    () =>
      pivotColumns(state.group, months).map((c) => ({
        ...c,
        render:
          c.key === state.group
            ? (r: SalesRow) =>
                r.id === MISSING_ID ? <span title="Lines with no purchase or BOM cost: counted in Sales, left out of Cost, GP and GP %">Cost missing</span> : r.key
            : (r: SalesRow) => cell(r, c.key, state.view),
      })),
    [state.group, state.view, months],
  );
  const rows = useMemo(() => (data?.rows.length && meta ? [{ ...meta.all, id: ALL_ID }, { ...meta.all, id: MISSING_ID }, ...data.rows] : (data?.rows ?? [])), [data, meta]);

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters))
      for (const value of values) out.push(key === "month" ? { key, label: "Month", value: monthLabel(value), values: [value] } : { key, label: dimLabel(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: dimLabel(key), value: `contains “${value}”`, search: true });
    return out;
  }, [state.filters, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  // Every group under the current filters and sort, All first, one row per month and the total.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const groups: SalesRow[] = [];
      let all: SalesRow | undefined;
      for (let page = 1; ; page++) {
        const res = await actions.loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all = res.data.meta?.all;
        groups.push(...res.data.rows);
        if (groups.length >= res.data.total || res.data.rows.length === 0) break;
      }
      const header = [dimLabel(state.group), "Month", "Sales", "Cost", "GP ₹", "GP %", "Quoted GP %", "Cost missing ₹", "Cost missing lines"];
      const csvRows = [...(all ? [all] : []), ...groups].flatMap((r) =>
        [...months, null].map((m) => {
          const c = (m ? r.byMonth[m] : r.total) ?? emptyCell();
          const g = gpOf(c);
          return [r.key, m ? monthLabel(m) : "Total", round(c.sales, 2), round(g.gp === null ? null : c.cost, 2), round(g.gp, 2),
            round(g.gpPct, 1), round(g.quotedGpPct, 1), round(c.missingSales, 2), c.missingLines];
        }),
      );
      downloadCsv(`sales_register_${fy}_${state.group}.csv`, toCsv(header, csvRows));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <GMDUpdateHeader title="SALES REGISTER" totalRows={kpi?.lines ?? 0} syncedAt={meta ? meta.syncedAt : undefined} warnIfStale />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-3 pb-6">
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={`Sales FY ${fy}`} value={kpi ? formatLakh(kpi.sales) : "–"} hint="Sum of invoice line values under the filters" />
          <Tile label="Invoices" value={kpi ? String(kpi.invoices) : "–"} />
          <Tile label="Parties" value={kpi ? String(kpi.parties) : "–"} />
          <Tile label="Undated lines" value={kpi ? String(kpi.undated) : "–"} hint="Lines with no readable invoice date: counted in totals, not in any month" />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
            Month-wise sales by
            <select className={SELECT} value={state.group} onChange={(e) => dispatch(setGroup(e.target.value as DimKey))}>
              {DIMS.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </label>
          <Segmented options={VIEWS} value={state.view} onChange={(v) => dispatch(setView(v))} label="Show" />
          <select className={SELECT} value={fy} onChange={(e) => dispatch(setFy(e.target.value))} aria-label="Financial year">
            {years.map((y) => (
              <option key={y} value={y}>FY {y}</option>
            ))}
          </select>
          <select
            className={SELECT}
            value={pickedMonths?.length === 1 ? pickedMonths[0] : ""}
            onChange={(e) => dispatch(setFilter({ key: "month", values: e.target.value ? [e.target.value] : [] }))}
            aria-label="Month"
          >
            <option value="">All months</option>
            {fiscalMonths(fy).map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
          <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search party, invoice, valve" />
          <FilterChips
            chips={chips}
            onRemove={(chip) =>
              chip.search
                ? dispatch(setColumnSearch({ key: chip.key, value: "" }))
                : dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }))
            }
            onClear={() => dispatch(clearFilters())}
          />
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
              {exporting ? "Exporting…" : "Download Excel (CSV)"}
            </Button>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowId={(r) => r.id}
          sort={state.sort}
          onSortChange={(s) => dispatch(setSort(s))}
          filters={state.filters}
          onFilterChange={(key, values) => dispatch(setFilter({ key, values }))}
          columnSearch={state.columnSearch}
          onColumnSearchChange={(key, value) => dispatch(setColumnSearch({ key, value }))}
          facetOptions={table.getFacetOptions}
          onFacetOpen={(key) => void table.requestFacet(key)}
          selectedId={selectedId}
          onSelect={setSelectedId}
          rowClassName={(r) => (r.id === ALL_ID ? "bg-muted/40 font-semibold" : r.id === MISSING_ID ? "text-xs text-muted-foreground" : undefined)}
          loading={table.loading}
          refreshing={table.refreshing}
          error={table.error}
          onRetry={() => void table.refresh()}
          hasFilters={hasFilters}
          onClearFilters={() => dispatch(clearFilters())}
          onPageStep={(d) => {
            const next = state.page + d;
            if (next >= 1 && next <= Math.ceil(total / state.pageSize)) dispatch(setPage(next));
          }}
        />
        <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
      </div>
    </main>
  );
}
