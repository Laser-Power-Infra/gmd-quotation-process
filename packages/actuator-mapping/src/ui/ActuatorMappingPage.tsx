"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { ColumnHeader } from "@gmd/ui/components/data-table/ColumnHeader";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { LoadingBar } from "@gmd/ui/components/data-table/LoadingBar";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatCell } from "@gmd/ui/components/data-table/format";
import type { TableSort } from "@gmd/ui/components/data-table/types";
import { Segmented } from "@gmd/ui/components/segmented";
import { cn } from "@gmd/ui/lib/utils";
import { MAKES, VIEWS, VIEW_KEYS, type ActuatorMappingActions, type Column, type KpiTile, type MakeFilter, type PageData, type Row, type SuitCode, type ViewKey } from "../columns";
import {
  clearFilters,
  queryOf,
  selectActuatorMapping,
  setColumnSearch,
  setFilter,
  setMake,
  setPage,
  setPageSize,
  setSearch,
  setSort,
  setView,
} from "../state/tableSlice";

export interface ActuatorMappingPageProps {
  actions: ActuatorMappingActions;
}

const count = new Intl.NumberFormat("en-IN");
const quantity = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const show = (v: number | null | undefined, format: KpiTile["format"]) =>
  v == null ? "–" : format === "money" ? `Rs ${rupees.format(v)}` : (format === "qty" ? quantity : count).format(v);

/** Mapping, Suitability and Stock views of the actuator workbook, one tab each. */
export function ActuatorMappingPage({ actions }: ActuatorMappingPageProps) {
  const dispatch = useDispatch();
  const { view, make } = useSelector(selectActuatorMapping);

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4 pb-2">
        <h1 className="text-lg font-semibold tracking-tight">Actuator &amp; Gearbox Mapping</h1>
        {/* Make picks the matrix's actuator / gearbox columns; Mapping shows the one pick and Stock filters make from its header. */}
        {view === "suitability" && (
          <Segmented label="Make" options={MAKES} value={make} onChange={(v) => dispatch(setMake(v))} className="ml-auto" />
        )}
      </div>
      <div role="tablist" aria-label="Views" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-6">
        {VIEW_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`actuator-tab-${key}`}
            aria-selected={key === view}
            aria-controls="actuator-panel"
            onClick={() => dispatch(setView(key))}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              key === view ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {VIEWS[key].label}
          </button>
        ))}
      </div>
      <section id="actuator-panel" role="tabpanel" aria-labelledby={`actuator-tab-${view}`} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        {/* Keyed: a tab switch starts from that view's skeleton, never the last view's rows. */}
        <ViewTable key={view} view={view} make={make} actions={actions} />
      </section>
    </main>
  );
}

const TILE = "min-w-36 flex-1 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left";

function ViewTable({ view, make, actions }: { view: ViewKey; make: MakeFilter; actions: ActuatorMappingActions }) {
  const dispatch = useDispatch();
  const state = useSelector(selectActuatorMapping).tables[view];
  const def = VIEWS[view];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo(() => queryOf(state), [state]);
  const filterKey = JSON.stringify({ filters: query.filters, columnSearch: query.columnSearch, search: query.search });
  // A key's facet ignores that key's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), columnSearch: omit(query.columnSearch), search: query.search });
    },
    [query],
  );

  const table = useServerTable<PageData>({
    queryKey: JSON.stringify(query),
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(view, query);
      if (!res.success) throw new Error(res.error || "Failed to load the view.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await actions.loadFacet(view, key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data } = table;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const columns = useMemo(() => def.columns.filter((c) => !c.make || make === "ALL" || c.make === make), [def, make]);
  const codes = useMemo(() => (data?.meta?.codes ?? []).filter((c) => make === "ALL" || c.make === make), [data, make]);

  const commitSearch = useCallback((value: string) => dispatch(setSearch({ view, value })), [dispatch, view]);
  const onSortChange = (sort: TableSort | null) => dispatch(setSort({ view, sort }));
  const onFilterChange = (key: string, values: string[]) => dispatch(setFilter({ view, key, values }));
  const onColumnSearchChange = (key: string, value: string) => dispatch(setColumnSearch({ view, key, value }));
  const clear = () => dispatch(clearFilters(view));

  const chips = useMemo<FilterChip[]>(() => {
    const labelOf = (key: string) => def.columns.find((c) => c.key === key)?.label ?? key;
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    return out;
  }, [def, state.filters, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  return (
    <>
      {[data?.meta?.refreshError, data?.meta?.stockError].map((line) => line && (
        <p key={line} role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {line}
        </p>
      ))}
      {def.kpis.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {def.kpis.map((t) => {
            const body = (
              <>
                <p className="truncate text-xs text-muted-foreground">{t.label}</p>
                <p className="mt-0.5 truncate text-lg font-semibold tracking-tight tabular-nums">{show(data?.meta?.kpi[t.key], t.format)}</p>
              </>
            );
            const filters = t.filters;
            if (!filters) return <div key={t.key} className={TILE}>{body}</div>;
            // The old mismatch report's sections: one click filters the table to that list.
            return (
              <button
                key={t.key}
                type="button"
                title="Show these lines"
                onClick={() => Object.entries(filters).forEach(([key, values]) => onFilterChange(key, values))}
                className={cn(TILE, "outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50")}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{def.note}</p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={state.search} onCommit={commitSearch} busy={table.refreshing} placeholder={def.searchPlaceholder} />
        <FilterChips
          chips={chips}
          onRemove={(chip) =>
            chip.search
              ? onColumnSearchChange(chip.key, "")
              : onFilterChange(chip.key, (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)))
          }
          onClear={clear}
        />
      </div>

      <div className="flex min-h-96 flex-1 flex-col">
        {/* The matrix once it has rows; until then the table shows the skeleton, the error or the empty state. */}
        {view === "suitability" && data && data.rows.length > 0 ? (
          <Matrix
            columns={columns}
            codes={codes}
            rows={data.rows}
            marks={data.meta?.marks ?? {}}
            refreshing={table.refreshing}
            header={(c) => (
              <ColumnHeader
                column={c}
                sort={state.sort}
                onSortChange={onSortChange}
                selected={state.filters[c.key] ?? []}
                facetOptions={table.getFacetOptions(c.key)}
                onFacetOpen={() => void table.requestFacet(c.key)}
                onFilterChange={(values) => onFilterChange(c.key, values)}
                onDateRangeChange={() => {}}
                search={state.columnSearch[c.key]}
                onSearchChange={(value) => onColumnSearchChange(c.key, value)}
              />
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowId={(r) => r.id}
            sort={state.sort}
            onSortChange={onSortChange}
            filters={state.filters}
            onFilterChange={onFilterChange}
            columnSearch={state.columnSearch}
            onColumnSearchChange={onColumnSearchChange}
            facetOptions={table.getFacetOptions}
            onFacetOpen={(key) => void table.requestFacet(key)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={table.loading}
            refreshing={table.refreshing}
            error={table.error}
            onRetry={() => void table.refresh()}
            hasFilters={hasFilters}
            onClearFilters={clear}
            onPageStep={(d) => {
              const next = state.page + d;
              if (next >= 1 && next <= Math.ceil(total / state.pageSize)) dispatch(setPage({ view, page: next }));
            }}
          />
        )}
      </div>
      <Pagination
        page={state.page}
        pageSize={state.pageSize}
        total={total}
        onPageChange={(page) => dispatch(setPage({ view, page }))}
        onPageSizeChange={(pageSize) => dispatch(setPageSize({ view, pageSize }))}
      />
    </>
  );
}

const MARK: Record<string, string> = {
  "✔": "font-bold text-green-700 dark:text-green-400",
  "○": "font-bold text-amber-600 dark:text-amber-400",
};
const HEAD = "border-r border-b border-primary-foreground/20 bg-primary text-xs text-primary-foreground last:border-r-0";
const CELL = "h-9 border-r border-b border-border px-3 whitespace-nowrap last:border-r-0";

/** Suitability matrix: the mapping's sortable, filterable columns, then one mark column per actuator / gearbox. */
function Matrix({ columns, codes, rows, marks, refreshing, header }: {
  columns: Column[];
  codes: SuitCode[];
  rows: Row[];
  marks: Record<string, Record<string, string>>;
  refreshing: boolean;
  header: (c: Column) => ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <LoadingBar active={refreshing} />
      <div aria-busy={refreshing} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="border-separate border-spacing-0 text-[13px] leading-tight">
          <thead className="sticky top-0 z-20">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn(HEAD, "group/th h-10 p-0 text-left font-semibold whitespace-nowrap")} style={{ minWidth: c.width }}>
                  {header(c)}
                </th>
              ))}
              {codes.map((c) => (
                <th key={c.code} scope="col" className={cn(HEAD, "px-2 py-1.5 text-center font-normal tabular-nums")}>
                  <div className="whitespace-nowrap font-semibold">{c.label}</div>
                  <div className="text-primary-foreground/80">{c.ratingNm === null ? "-" : formatCell(c.ratingNm, "number")} Nm</div>
                  <div className="text-primary-foreground/80">stock {c.stock === null ? "-" : formatCell(c.stock, "number")}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="even:bg-muted/40 hover:bg-primary/6">
                {columns.map((c) => (
                  <td key={c.key} className={cn(CELL, c.align === "right" && "text-right tabular-nums")}>
                    {formatCell(r[c.key], c.kind)}
                  </td>
                ))}
                {codes.map((c) => {
                  const mark = marks[r.id]?.[c.code] ?? "";
                  return (
                    <td key={c.code} className={cn(CELL, "text-center", MARK[mark] ?? "text-muted-foreground")}>
                      {mark}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
