"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatCell } from "@gmd/ui/components/data-table/format";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import MultiSelectFilter from "@gmd/ui/components/multi-select-filter";
import { Segmented } from "@gmd/ui/components/segmented";
import { formatLakh } from "@gmd/ui/lib/format";
import { PAYABLE_COLUMNS, PO_COLUMNS, SLICERS, type ChartBar, type PoRow, type PurchasePageData, type PurchaseV2Actions } from "../../poColumns";
import {
  clearFilters,
  queryOf,
  select,
  selectPurchaseTable,
  setColumnSearch,
  setDateRange,
  setFilter,
  setOpenOnly,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from "../../state/tableSlice";
import { BarList, KpiCards, MonthColumns, ageingBars } from "./Charts";
import { PoLines } from "./PoLines";

export interface PurchasePageProps {
  actions: PurchaseV2Actions;
  title?: string;
  /** Item code clicked in the drill-down (host opens Physical Stock). */
  onItemClick?: (itemCode: string) => void;
  /** Sales contract clicked (host opens Contract Review). */
  onContractClick?: (contract: string) => void;
}

const count = new Intl.NumberFormat("en-IN");
const STALE_MS = 24 * 60 * 60 * 1000;
const overdueClass = (r: PoRow) => (r.status === "Overdue" ? "text-red-800 dark:text-red-300" : undefined);
const labelOf = (key: string) => PO_COLUMNS.find((c) => c.key === key)?.label ?? SLICERS.find((s) => s.key === key)?.label ?? key;
const payableHint = (b: ChartBar) =>
  b.payable
    ? `Bills ${formatLakh(b.payable.bills)}, advances ${formatLakh(b.payable.advances)}, net ${formatLakh(b.payable.net)}, overdue ${formatLakh(b.payable.overdue)}, 180+ ${formatLakh(b.payable.over180)}`
    : null;

export function PurchasePage({ actions, title = "Purchases & Pending Receipts", onItemClick, onContractClick }: PurchasePageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectPurchaseTable);
  const { loadPage, loadFacet, loadLines } = actions;

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, dateRanges: query.dateRanges, columnSearch: query.columnSearch, search: query.search, extra: query.extra });
  // A key's facet ignores that key's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), dateRanges: omit(query.dateRanges), columnSearch: omit(query.columnSearch), search: query.search, extra: query.extra });
    },
    [query],
  );

  const table = useServerTable<PurchasePageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load purchases.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data } = table;
  const meta = data?.meta;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const columns = useMemo<DataColumn<PoRow>[]>(
    () =>
      PO_COLUMNS.map((c) => {
        if (c.key === "receivedPct") return { ...c, render: (r) => (r.receivedPct === null ? "" : `${Math.round(r.receivedPct)}%`) };
        const pay = PAYABLE_COLUMNS.find((p) => p.key === c.key);
        if (pay) return { ...c, render: (r) => (r.payable ? formatCell(r.payable[pay.field], "number") : "") };
        if (c.key === "contract" && onContractClick)
          return {
            ...c,
            render: (r) => (
              <span className="flex gap-1.5">
                {(r.contract ?? "").split(", ").filter(Boolean).map((contract) => (
                  <button
                    key={contract}
                    type="button"
                    title="Open in Contract Review"
                    className="rounded-sm text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onContractClick(contract);
                    }}
                  >
                    {contract}
                  </button>
                ))}
              </span>
            ),
          };
        return c;
      }),
    [onContractClick],
  );

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  const supplierSelected = state.filters.supplier ?? [];
  const toggleSupplier = (b: ChartBar) =>
    dispatch(setFilter({ key: "supplier", values: supplierSelected.includes(b.label) ? supplierSelected.filter((v) => v !== b.label) : [...supplierSelected, b.label] }));

  const syncedAt = meta?.syncedAt ? new Date(meta.syncedAt) : null;
  const stale = syncedAt !== null && Date.now() - syncedAt.getTime() > STALE_MS;

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col gap-3 overflow-y-auto bg-background p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} purchase orders` : ""}</span>
        {syncedAt && (
          <span className={stale ? "text-sm font-medium text-amber-700 dark:text-amber-400" : "text-sm text-muted-foreground"}>
            {stale ? "Data is stale: last synced " : "Synced "}
            {syncedAt.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <Segmented
          className="ml-auto"
          label="Lines shown"
          options={[
            { value: "open", label: "Open" },
            { value: "all", label: "All" },
          ]}
          value={state.openOnly ? "open" : "all"}
          onChange={(v) => dispatch(setOpenOnly(v === "open"))}
        />
      </header>

      <KpiCards kpi={meta?.kpi} />

      <div className="flex min-h-0 flex-1 gap-4">
        <aside aria-label="Slicers" className="flex w-52 shrink-0 flex-col gap-3">
          {SLICERS.map((s) => {
            const selected = state.filters[s.key] ?? [];
            const options = table.getFacetOptions(s.key) ?? selected;
            return (
              <div key={s.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
                <MultiSelectFilter
                  label={s.label}
                  allLabel="All"
                  options={options}
                  cascadedOptions={options}
                  selected={selected}
                  onChange={(values) => dispatch(setFilter({ key: s.key, values }))}
                  onOpen={() => void table.requestFacet(s.key)}
                  renderButtonLabel={(sel, all) => (sel.length === 1 ? sel[0] : sel.length ? `${sel.length} selected` : all)}
                  className="h-8 w-full"
                />
              </div>
            );
          })}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <BarList title="Open value by days past delivery date" bars={ageingBars(meta?.ageing ?? [])} />
            <BarList
              title="Open value by supplier (top 10), with payment outstanding"
              bars={meta?.suppliers ?? []}
              active={(b) => supplierSelected.includes(b.label)}
              onPick={toggleSupplier}
              hint={payableHint}
            />
            <MonthColumns title="Expected receipts by delivery month" bars={meta?.monthly ?? []} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search PO, item, supplier, contract" />
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
          </div>

          <div className="flex min-h-96 flex-1 flex-col">
            <DataTable
              columns={columns}
              rows={data?.rows ?? []}
              rowId={(r) => r.poNo}
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
              onSelect={(id) => dispatch(select(id))}
              rowClassName={overdueClass}
              renderDetail={(po) => <PoLines po={po} query={query} filterKey={filterKey} loadLines={loadLines} onItemClick={onItemClick} onContractClick={onContractClick} />}
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
          <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
        </section>
      </div>
    </main>
  );
}
