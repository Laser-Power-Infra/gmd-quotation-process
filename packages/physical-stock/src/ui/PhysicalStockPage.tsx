"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { BLANK, type DataColumn } from "@gmd/ui/components/data-table/types";
import { cn } from "@gmd/ui/lib/utils";
import type { PhysicalStockFlags, SidebarSection } from "../flags";
import { CASCADE_FIELDS, columnsFor } from "../stockColumns";
import {
  clearFilters,
  queryOf,
  select,
  selectStockTable,
  setColumnSearch,
  setDateRange,
  setDuplicatesOnly,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setSort,
  toggleCard,
  toggleMajorMinor,
  toggleSidebar,
} from "../state/tableSlice";
import type { PhysicalStockActions, PhysicalStockPageData, PhysicalStockRow } from "../types";
import StockAnalyticsSidebar from "./StockAnalyticsSidebar";
import NewItemDialog from "./NewItemDialog";

export interface PhysicalStockPageProps {
  flags: PhysicalStockFlags;
  actions: PhysicalStockActions;
  /** Set false when the host app renders the header (and New button) elsewhere. */
  showHeader?: boolean;
}

const count = new Intl.NumberFormat("en-IN");
const duplicateClass = (r: PhysicalStockRow) => (r.is_duplicate ? "bg-secondary/70 data-[selected=true]:bg-secondary" : undefined);

export function PhysicalStockPage({ flags, actions, showHeader = true }: PhysicalStockPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectStockTable);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const { loadPage, loadFacet, loadCodeOptions, updateField, create, revertEntry, updateBomId } = actions;

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

  const columns = useMemo(() => columnsFor(flags, { bomId: Boolean(updateBomId) }), [flags, updateBomId]);
  const showSection = useCallback((s: SidebarSection) => !flags.hiddenSidebar.includes(s), [flags]);

  const table = useServerTable<PhysicalStockPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load physical stock.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data, setData, refresh } = table;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  // A "New" button rendered outside this component (e.g. the app navbar) asks
  // the table to reload through this event.
  useEffect(() => {
    const onCreated = () => void refresh();
    window.addEventListener("physical-stock:created", onCreated);
    return () => window.removeEventListener("physical-stock:created", onCreated);
  }, [refresh]);

  const onSelect = useCallback((id: string | null) => dispatch(select(id)), [dispatch]);

  const patchRow = useCallback(
    (id: string, changes: Partial<PhysicalStockRow>) =>
      setData((prev) => prev && { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...changes } : r)) }),
    [setData],
  );

  const onEdit = useCallback(
    async (row: PhysicalStockRow, column: DataColumn<PhysicalStockRow>, value: string) => {
      const toastId = toast.loading(`Saving ${column.label}…`);
      if (column.key === "bom_id") {
        const res = await updateBomId!(row.id, value || null);
        if (!res.success) {
          toast.error(res.error || "Could not save BOM ID", { id: toastId });
          return false;
        }
        patchRow(row.id, res.data);
        toast.success("BOM ID saved", { id: toastId });
        return true;
      }
      const res = await updateField(row.id, column.key, value);
      if (!res.success) {
        toast.error(res.error || `Could not save ${column.label}`, { id: toastId });
        return false;
      }
      if (res.data.merged) {
        const m = res.data.merged;
        toast.success(
          `Merged into ERP ${m.erp_code}: location and L columns matched. Received ${m.received_qty ?? 0}, dispatch ${m.dispatch_qty ?? 0}, available ${m.available_qty ?? 0}.`,
          { id: toastId, duration: 8000 },
        );
        void refresh();
        return true;
      }
      patchRow(row.id, res.data);
      toast.success(`${column.label} saved`, { id: toastId });
      return true;
    },
    [updateBomId, updateField, patchRow, refresh],
  );

  // Select editors: BOM IDs come with the page; L / Dia lists cascade on the row's other levels.
  const editOptions = useCallback(
    async (row: PhysicalStockRow, column: DataColumn<PhysicalStockRow>): Promise<readonly string[]> => {
      if (column.key === "bom_id") return data?.meta?.bomIdOptions?.[row.id] ?? [];
      const filters: Record<string, string[]> = {};
      for (const f of CASCADE_FIELDS) {
        const v = String(row[f] ?? "").trim();
        if (f !== column.key && v) filters[f] = [v];
      }
      const res = await loadFacet(column.key, { page: 1, pageSize: 1, sort: null, search: "", filters });
      const seen = res.success ? res.data.filter((v) => v !== BLANK) : [];
      // Only options seen with this combination; a new combination gets the full list.
      const narrowed = (column.options ?? []).filter((o) => seen.includes(o));
      return narrowed.length ? narrowed : (column.options ?? []);
    },
    [data, loadFacet],
  );

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) {
      const label = columns.find((c) => c.key === key)?.label ?? key;
      for (const value of values) out.push({ key, label, value });
    }
    for (const [key, value] of Object.entries(state.columnSearch)) {
      const label = columns.find((c) => c.key === key)?.label ?? key;
      out.push({ key, label, value: `contains “${value}”`, search: true });
    }
    for (const [key, range] of Object.entries(state.dateRanges)) {
      const label = columns.find((c) => c.key === key)?.label ?? key;
      out.push({ key, label, value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    }
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch, columns]);
  const hasFilters = chips.length > 0 || Boolean(state.search) || Boolean(state.card) || state.majorMinor.length > 0 || state.duplicatesOnly;

  const total = data?.total ?? 0;
  const meta = data?.meta;
  const showNew = showHeader && flags.newItem && create;

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">
        {showHeader && (
          <header className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Physical Stock</h1>
            <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} items` : ""}</span>
          </header>
        )}
        {showNew && (
          <NewItemDialog
            open={showNewDialog}
            onOpenChange={setShowNewDialog}
            loadFacet={loadFacet}
            loadCodeOptions={loadCodeOptions}
            create={create}
            revertEntry={revertEntry}
            onCreated={() => void refresh()}
          />
        )}
        <div className="flex min-h-0 flex-1 gap-4">
          <StockAnalyticsSidebar
            show={showSection}
            availableQty={meta?.totals.availableQty ?? 0}
            availableValue={meta?.totals.availableValue ?? 0}
            collapsed={state.sidebarCollapsed}
            onToggle={() => dispatch(toggleSidebar())}
            activeCard={state.card}
            onCardClick={(kind) => dispatch(toggleCard(kind))}
            majorMinorSelection={new Set(state.majorMinor)}
            majorMinorCounts={meta?.majorMinorCounts ?? { yes: 0, no: 0, blank: 0 }}
            onToggleMajorMinor={(kind) => dispatch(toggleMajorMinor(kind))}
          />
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search stock" />
              <FilterChips
                chips={chips}
                onRemove={(chip) =>
                  chip.date
                    ? dispatch(setDateRange({ key: chip.key, range: undefined }))
                    : chip.search
                      ? dispatch(setColumnSearch({ key: chip.key, value: "" }))
                      : dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => v !== chip.value) }))
                }
                onClear={() => dispatch(clearFilters())}
              />
              <div className="ml-auto flex items-center gap-2">
                {flags.duplicateErpHighlight && (
                  <button
                    type="button"
                    aria-pressed={state.duplicatesOnly}
                    onClick={() => dispatch(setDuplicatesOnly(!state.duplicatesOnly))}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-[background-color,color,border-color,transform] duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none",
                      state.duplicatesOnly
                        ? "border-amber-400/60 bg-amber-400/15 text-amber-700 dark:text-amber-300"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Copy size={12} />
                    Duplicates only
                  </button>
                )}
                {showNew && (
                  <Button size="sm" onClick={() => setShowNewDialog(true)}>
                    <Plus />
                    New item
                  </Button>
                )}
              </div>
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
              selectedId={state.selectedId}
              onSelect={onSelect}
              onEdit={onEdit}
              editOptions={editOptions}
              rowClassName={duplicateClass}
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
            <Pagination
              page={state.page}
              pageSize={state.pageSize}
              total={total}
              onPageChange={(p) => dispatch(setPage(p))}
              onPageSizeChange={(s) => dispatch(setPageSize(s))}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
