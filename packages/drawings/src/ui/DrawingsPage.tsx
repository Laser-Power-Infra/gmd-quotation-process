"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import type { DataColumn, TablePage } from "@gmd/ui/components/data-table/types";
import { Segmented } from "@gmd/ui/components/segmented";
import { DRAWING_COLUMNS, NO_DRAWINGS, type DrawingRow, type DrawingsQuery } from "../columns";
import {
  clearFilters,
  queryOf,
  selectDrawingsTable,
  setColumnSearch,
  setFilter,
  setMode,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from "../state/tableSlice";
import { ContractDrawingsDialog, DaysAtStage, type ContractDrawingsActions, type DrawingActionResult, type DrawingRights } from "./ContractDrawingsDialog";

/** The contract window's actions plus the page's server-paged list and facets. */
export interface DrawingsPageActions extends ContractDrawingsActions {
  /** listDrawingsPage. */
  loadPage: (query: DrawingsQuery) => Promise<DrawingActionResult<TablePage<DrawingRow>>>;
  /** listDrawingsFacet. */
  loadFacet: (key: string, query: DrawingsQuery) => Promise<DrawingActionResult<string[]>>;
}

export interface DrawingsPageProps {
  actions: DrawingsPageActions;
  rights: DrawingRights;
}

const count = new Intl.NumberFormat("en-IN");

// Status and days get their look here; every other cell renders as ../columns says.
const COLUMNS: DataColumn<DrawingRow>[] = DRAWING_COLUMNS.map((c) =>
  c.key === "status"
    ? { ...c, render: (r) => (r.status === NO_DRAWINGS ? <span className="text-muted-foreground">{NO_DRAWINGS}</span> : r.status) }
    : c.key === "daysAtStage"
      ? { ...c, render: (r) => <DaysAtStage days={r.daysAtStage} status={r.status} /> }
      : c,
);

/** Every live contract with its drawing status, one row per current drawing; a row opens the contract's window. */
export function DrawingsPage({ actions, rights }: DrawingsPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectDrawingsTable);
  const { loadPage, loadFacet } = actions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The contract window; its number stays while it fades out.
  const [win, setWin] = useState({ contractNo: "", open: false });

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, columnSearch: query.columnSearch, search: query.search, extra: query.extra });
  // A column's facet ignores that column's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), columnSearch: omit(query.columnSearch), search: query.search, extra: query.extra });
    },
    [query],
  );

  const table = useServerTable<TablePage<DrawingRow>>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load the drawings.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data, refresh } = table;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const commitSearch = useCallback((value: string) => dispatch(setSearch(value)), [dispatch]);

  const chips = useMemo<FilterChip[]>(() => {
    const labelOf = (key: string) => DRAWING_COLUMNS.find((c) => c.key === key)?.label ?? key;
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    return out;
  }, [state.filters, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  const openRow = (id: string | null) => {
    const row = id ? data?.rows.find((r) => r.id === id) : undefined;
    if (!row) return;
    setSelectedId(row.id);
    setWin({ contractNo: row.contractNo, open: true });
  };

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">
        <header className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Drawings</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} rows` : ""}</span>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={state.search} onCommit={commitSearch} busy={table.refreshing} placeholder="Search contract, party, PO, drawing no" />
          <FilterChips
            chips={chips}
            onRemove={(chip) =>
              chip.search
                ? dispatch(setColumnSearch({ key: chip.key, value: "" }))
                : dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }))
            }
            onClear={() => dispatch(clearFilters())}
          />
          <Segmented
            className="ml-auto"
            label="Drawings to show"
            options={[
              { value: "all", label: "All" },
              { value: "pending", label: "Pending" },
            ]}
            value={state.mode}
            onChange={(mode) => dispatch(setMode(mode))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Pending leaves out contracts with no drawing and drawings the client has approved. Click a row, or press Enter on the highlighted row, to open
          that contract&apos;s drawings.
        </p>
        {/* A click on a row, or Enter on the highlighted one, opens its contract; arrow keys only move the highlight. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          onClick={(e) => openRow((e.target as Element).closest("tr[data-row-id]")?.getAttribute("data-row-id") ?? null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e.target as Element).closest("button, input, a, [role=dialog]")) openRow(selectedId);
          }}
        >
          <DataTable
            columns={COLUMNS}
            rows={data?.rows ?? []}
            rowId={(r) => r.id}
            sort={state.sort}
            onSortChange={(sort) => dispatch(setSort(sort))}
            filters={state.filters}
            onFilterChange={(key, values) => dispatch(setFilter({ key, values }))}
            columnSearch={state.columnSearch}
            onColumnSearchChange={(key, value) => dispatch(setColumnSearch({ key, value }))}
            facetOptions={table.getFacetOptions}
            onFacetOpen={(key) => void table.requestFacet(key)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={table.loading}
            refreshing={table.refreshing}
            error={table.error}
            onRetry={() => void refresh()}
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
      </div>
      <ContractDrawingsDialog
        contractNo={win.contractNo}
        open={win.open}
        onClose={() => {
          setWin((w) => ({ ...w, open: false }));
          // The window may have changed statuses and days: reload this page of rows.
          void refresh();
        }}
        actions={actions}
        rights={rights}
      />
    </main>
  );
}
