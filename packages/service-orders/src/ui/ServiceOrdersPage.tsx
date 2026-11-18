"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Download, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatCell } from "@gmd/ui/components/data-table/format";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { formatLakh } from "@gmd/ui/lib/format";
import { cn } from "@gmd/ui/lib/utils";
import { COLUMNS, KPIS, type ServiceOrderRow, type ServiceOrdersActions, type ServiceOrdersPageData } from "../columns";
import {
  clearFilters,
  queryOf,
  selectServiceOrders,
  setColumnSearch,
  setDateRange,
  setFilter,
  setOverdueOnly,
  setPage,
  setPageSize,
  setSearch,
  setShowClosed,
  setSort,
} from "../state/tableSlice";

export interface ServiceOrdersPageProps {
  actions: ServiceOrdersActions;
}

const count = new Intl.NumberFormat("en-IN");
const RED = "font-semibold text-red-700 dark:text-red-400";
const orderLine = (r: ServiceOrderRow) => `${r.orderNo}/${r.lineNo}`;

/** Cells drawn differently from their plain value. */
const CELLS: Record<string, (r: ServiceOrderRow) => ReactNode> = {
  orderNo: orderLine,
  daysPending: (r) => <span className={(r.daysPending ?? 0) > 30 ? RED : undefined}>{formatCell(r.daysPending, "number")}</span>,
  pending: (r) => <span className="font-semibold">{formatCell(r.pending, "number")}</span>,
  pendingValue: (r) => (r.pendingValue === null ? "" : formatLakh(r.pendingValue)),
  dueDate: (r) => <span className={r.overdue ? RED : undefined}>{formatCell(r.dueDate, "date")}</span>,
};
const columns: DataColumn<ServiceOrderRow>[] = COLUMNS.map((c) => (CELLS[c.key] ? { ...c, render: CELLS[c.key] } : c));
const rowClass = (r: ServiceOrderRow) => (r.overdue ? "bg-red-50 dark:bg-red-950/30" : undefined);
const labelOf = (key: string) => COLUMNS.find((c) => c.key === key)?.label ?? key;

/** Open service and job-work orders: days pending, receipts pending. */
export function ServiceOrdersPage({ actions }: ServiceOrdersPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectServiceOrders);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, dateRanges: query.dateRanges, columnSearch: query.columnSearch, search: query.search, extra: query.extra });
  // A column's facet ignores that column's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), dateRanges: omit(query.dateRanges), columnSearch: omit(query.columnSearch), search: query.search, extra: query.extra });
    },
    [query],
  );

  const table = useServerTable<ServiceOrdersPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load service orders.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await actions.loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data } = table;
  const total = data?.total ?? 0;
  const meta = data?.meta;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const commitSearch = useCallback((value: string) => dispatch(setSearch(value)), [dispatch]);

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search) || state.overdueOnly;

  // Every page under the current filters and sort, as the table shows them.
  const [exporting, setExporting] = useState(false);
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const all: ServiceOrderRow[] = [];
      for (let page = 1; ; page++) {
        const res = await actions.loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all.push(...res.data.rows);
        if (all.length >= res.data.total || res.data.rows.length === 0) break;
      }
      const cell = (r: ServiceOrderRow, c: DataColumn<ServiceOrderRow>) => {
        const v = (r as unknown as Record<string, string | number | null>)[c.key];
        return c.key === "orderNo" ? orderLine(r) : c.kind === "date" ? formatCell(v, "date") : v;
      };
      downloadCsv("service_work_orders.csv", toCsv(COLUMNS.map((c) => c.label), all.map((r) => COLUMNS.map((c) => cell(r, c)))));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [actions, query]);

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Service / Work Orders</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} lines` : ""}</span>
          {meta?.syncedAt && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">Service list synced {new Date(meta.syncedAt).toLocaleString("en-IN")}</span>
          )}
        </header>

        {meta?.allLines === 0 ? (
          <div className="rounded-lg border border-border bg-card py-16 text-center">
            <Wrench className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium text-muted-foreground">
              {meta.serviceCodes === 0 ? "No service codes synced yet." : "No service or work orders found for the synced service codes."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {KPIS.map((t) => {
                const v = meta?.kpi[t.key];
                return (
                  <div key={t.key} className="min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5">
                    <p className="truncate text-xs text-muted-foreground">{t.label}</p>
                    <p className={cn("mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums", t.danger && "text-red-700 dark:text-red-400")}>
                      {v === undefined ? "–" : t.money ? formatLakh(v) : count.format(v)}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SearchField value={state.search} onCommit={commitSearch} busy={table.refreshing} placeholder="Search order, supplier or service" />
              <FilterChips
                chips={chips}
                onRemove={(chip) =>
                  chip.date
                    ? dispatch(setDateRange({ key: chip.key, range: undefined }))
                    : chip.search
                      ? dispatch(setColumnSearch({ key: chip.key, value: "" }))
                      : dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }))
                }
                onClear={() => dispatch(clearFilters())}
              />
              <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={state.showClosed} onChange={(e) => dispatch(setShowClosed(e.target.checked))} />
                  Show fully received
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={state.overdueOnly} onChange={(e) => dispatch(setOverdueOnly(e.target.checked))} />
                  Past due only
                </label>
                <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
                  <Download />
                  {exporting ? "Exporting…" : "Download CSV"}
                </Button>
              </div>
            </div>

            <div className="flex min-h-96 flex-1 flex-col">
              <DataTable
                columns={columns}
                rows={data?.rows ?? []}
                rowId={(r) => r.id}
                sort={state.sort}
                onSortChange={(sort) => dispatch(setSort(sort))}
                filters={state.filters}
                onFilterChange={(key, values) => dispatch(setFilter({ key, values }))}
                dateRanges={state.dateRanges}
                onDateRangeChange={(key, range) => dispatch(setDateRange({ key, range }))}
                columnSearch={state.columnSearch}
                onColumnSearchChange={(key, value) => dispatch(setColumnSearch({ key, value }))}
                facetOptions={table.getFacetOptions}
                onFacetOpen={(key) => void table.requestFacet(key)}
                selectedId={selectedId}
                onSelect={setSelectedId}
                rowClassName={rowClass}
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
            </div>
            <Pagination
              page={state.page}
              pageSize={state.pageSize}
              total={total}
              onPageChange={(page) => dispatch(setPage(page))}
              onPageSizeChange={(pageSize) => dispatch(setPageSize(pageSize))}
            />
          </>
        )}
      </div>
    </main>
  );
}
