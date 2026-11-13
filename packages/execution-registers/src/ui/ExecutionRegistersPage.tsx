"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatLakh } from "@gmd/ui/lib/format";
import { cn } from "@gmd/ui/lib/utils";
import { REGISTERS, REGISTER_KEYS, type ExecutionRegistersActions, type KpiTile, type RegisterKey, type RegisterPageData } from "../columns";
import {
  clearFilters,
  queryOf,
  selectExecutionRegisters,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setSort,
  setTab,
} from "../state/tableSlice";

export interface ExecutionRegistersPageProps {
  actions: ExecutionRegistersActions;
}

type Head = { total: number; syncedAt: string | null };

const count = new Intl.NumberFormat("en-IN");
const quantity = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const show = (v: number | undefined, format: KpiTile["format"]) =>
  v === undefined ? "–" : format === "money" ? formatLakh(v) : (format === "qty" ? quantity : count).format(v);

/** Dispatch / LR, MC and Production registers, one tab each. */
export function ExecutionRegistersPage({ actions }: ExecutionRegistersPageProps) {
  const dispatch = useDispatch();
  const { tab } = useSelector(selectExecutionRegisters);
  // Line count and sync time of the open register, for the shared header and its stale banner.
  const [head, setHead] = useState<Head | null>(null);

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <GMDUpdateHeader title="EXECUTION REGISTERS" totalRows={head?.total ?? 0} syncedAt={head ? head.syncedAt : undefined} warnIfStale />
      <div role="tablist" aria-label="Registers" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-6">
        {REGISTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`register-tab-${key}`}
            aria-selected={key === tab}
            aria-controls="register-panel"
            onClick={() => {
              if (key === tab) return;
              setHead(null);
              dispatch(setTab(key));
            }}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              key === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {REGISTERS[key].label}
          </button>
        ))}
      </div>
      <section id="register-panel" role="tabpanel" aria-labelledby={`register-tab-${tab}`} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        {/* Keyed: a tab switch starts from that register's skeleton, never the last register's rows. */}
        <RegisterTable key={tab} register={tab} actions={actions} onLoaded={setHead} />
      </section>
    </main>
  );
}

function RegisterTable({ register, actions, onLoaded }: { register: RegisterKey; actions: ExecutionRegistersActions; onLoaded: (head: Head) => void }) {
  const dispatch = useDispatch();
  const state = useSelector(selectExecutionRegisters).tables[register];
  const def = REGISTERS[register];
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

  const table = useServerTable<RegisterPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(register, query);
      if (!res.success) throw new Error(res.error || "Failed to load the register.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await actions.loadFacet(register, key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data } = table;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);
  useEffect(() => {
    if (data) onLoaded({ total: data.total, syncedAt: data.meta?.syncedAt ?? null });
  }, [data, onLoaded]);

  const commitSearch = useCallback((value: string) => dispatch(setSearch({ register, value })), [dispatch, register]);

  const chips = useMemo<FilterChip[]>(() => {
    const labelOf = (key: string) => def.columns.find((c) => c.key === key)?.label ?? key;
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [def, state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {def.kpis.map((t) => (
          <div key={t.key} className="min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5">
            <p className="truncate text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums">{show(data?.meta?.kpi[t.key], t.format)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{def.note}</p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={state.search} onCommit={commitSearch} busy={table.refreshing} placeholder={def.searchPlaceholder} />
        <FilterChips
          chips={chips}
          onRemove={(chip) =>
            chip.date
              ? dispatch(setDateRange({ register, key: chip.key, range: undefined }))
              : chip.search
                ? dispatch(setColumnSearch({ register, key: chip.key, value: "" }))
                : dispatch(setFilter({ register, key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => v !== chip.value) }))
          }
          onClear={() => dispatch(clearFilters(register))}
        />
      </div>

      <div className="flex min-h-96 flex-1 flex-col">
        <DataTable
          columns={def.columns}
          rows={data?.rows ?? []}
          rowId={(r) => r.id}
          sort={state.sort}
          onSortChange={(sort) => dispatch(setSort({ register, sort }))}
          filters={state.filters}
          onFilterChange={(key, values) => dispatch(setFilter({ register, key, values }))}
          dateRanges={state.dateRanges}
          onDateRangeChange={(key, range) => dispatch(setDateRange({ register, key, range }))}
          columnSearch={state.columnSearch}
          onColumnSearchChange={(key, value) => dispatch(setColumnSearch({ register, key, value }))}
          facetOptions={table.getFacetOptions}
          onFacetOpen={(key) => void table.requestFacet(key)}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={table.loading}
          refreshing={table.refreshing}
          error={table.error}
          onRetry={() => void table.refresh()}
          hasFilters={hasFilters}
          onClearFilters={() => dispatch(clearFilters(register))}
          onPageStep={(d) => {
            const next = state.page + d;
            if (next >= 1 && next <= Math.ceil(total / state.pageSize)) dispatch(setPage({ register, page: next }));
          }}
        />
      </div>
      <Pagination
        page={state.page}
        pageSize={state.pageSize}
        total={total}
        onPageChange={(page) => dispatch(setPage({ register, page }))}
        onPageSizeChange={(pageSize) => dispatch(setPageSize({ register, pageSize }))}
      />
    </>
  );
}
