"use client";

import { useCallback, useEffect, useMemo, useState, type ElementType, type MouseEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { Segmented } from "@gmd/ui/components/segmented";
import { INSPECTION_COLUMNS, REPORT_STATUSES, type InspectionOfferRow, type InspectionPageData, type InspectionReportsActions } from "../columns";
import {
  clearFilters,
  queryOf,
  selectInspectionReports,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from "../state/tableSlice";

export interface InspectionReportsPageProps {
  actions: InspectionReportsActions;
  /** Renders the links to each report; the app passes next/link (this package has no next dependency). */
  linkAs?: ElementType;
}

const count = new Intl.NumberFormat("en-IN");
const labelOf = (key: string) => INSPECTION_COLUMNS.find((c) => c.key === key)?.label ?? key;
const STATUS_OPTIONS = [{ value: "all", label: "All" }, ...REPORT_STATUSES.map((s) => ({ value: s as string, label: s }))];

function DetailList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section>
      <h3 className="mb-1 font-medium text-muted-foreground">{title}</h3>
      {lines.length ? (
        <ul className="space-y-0.5">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">None entered</p>
      )}
    </section>
  );
}

/** Inspection offers synced from the ERP dump, each with its auto-drafted report. A row opens its serial ranges and team. */
export function InspectionReportsPage({ actions, linkAs: LinkAs = "a" }: InspectionReportsPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectInspectionReports);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, dateRanges: query.dateRanges, columnSearch: query.columnSearch, search: query.search });
  // A key's facet ignores that key's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), dateRanges: omit(query.dateRanges), columnSearch: omit(query.columnSearch), search: query.search });
    },
    [query],
  );

  const table = useServerTable<InspectionPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load inspection offers.");
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

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const columns = useMemo<DataColumn<InspectionOfferRow>[]>(
    () =>
      INSPECTION_COLUMNS.map((c) => {
        if (c.key === "vrno")
          return {
            ...c,
            render: (r) =>
              r.reportId ? (
                <LinkAs
                  href={`/inspection_reports/${r.reportId}`}
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                  className="text-primary underline underline-offset-2"
                >
                  {r.vrno}
                </LinkAs>
              ) : (
                r.vrno
              ),
          };
        if (c.key === "status") return { ...c, render: (r) => r.status || "—" };
        if (c.key === "checks")
          return {
            ...c,
            render: (r) =>
              r.checksTotal === null ? (
                "—"
              ) : (
                <span className={r.checksPassed === r.checksTotal ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                  {r.checksPassed}/{r.checksTotal}
                </span>
              ),
          };
        return c;
      }),
    [LinkAs],
  );

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);
  // The status pills are a shortcut for the Report column filter; a mixed pick lights none.
  const statuses = state.filters.status ?? [];
  const statusPill = statuses.length === 0 ? "all" : statuses.length === 1 ? statuses[0] : "";

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Inspection Reports</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} offer${total === 1 ? "" : "s"}` : ""}</span>
          <Segmented
            label="Report status"
            options={STATUS_OPTIONS}
            value={statusPill}
            onChange={(v) => dispatch(setFilter({ key: "status", values: v === "all" ? [] : [v] }))}
          />
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={state.search}
            onCommit={(v) => dispatch(setSearch(v))}
            busy={table.refreshing}
            placeholder="Search offer / MC / contract / serial no."
            className="w-80"
          />
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
        </div>
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowId={(r) => r.id}
          sort={state.sort}
          onSortChange={(s) => dispatch(setSort(s))}
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
          renderDetail={(r) => (
            <div className="flex flex-wrap gap-x-10 gap-y-3 text-xs">
              <DetailList title="Serial nos." lines={r.serialRanges} />
              <DetailList title="Inspecting team" lines={r.teamMembers} />
            </div>
          )}
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
        <Pagination
          page={state.page}
          pageSize={state.pageSize}
          total={total}
          onPageChange={(p) => dispatch(setPage(p))}
          onPageSizeChange={(s) => dispatch(setPageSize(s))}
        />
      </div>
    </main>
  );
}
