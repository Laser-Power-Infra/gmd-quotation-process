"use client";

import { useCallback, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { Button } from "@gmd/ui/components/button";
import { Tile } from "@gmd/ui/components/plain-table";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { formatIndianNumber, formatLakh } from "@gmd/ui/lib/format";
import { READY_COLUMNS, READY_STAGES, type ReadyToBillActions, type ReadyToBillPageData, type ReadyToBillRow } from "../readyToBill";
import { clearFilters, queryOf, select, selectReadyToBill, setFilter, setPage, setPageSize, setSearch, setSort } from "../state/readyToBillSlice";

const labelOf = (key: string) => READY_COLUMNS.find((c) => c.key === key)?.label ?? key;
const money = (v: number, lines: number) => `${formatLakh(v)} · ${lines} lines`;

/** Order lines with stock held against them (valve and actuator), one server page at a time. */
export default function ReadyToBillPage({ actions, syncedAt }: { actions: ReadyToBillActions; syncedAt: string | null }) {
  const dispatch = useDispatch();
  const state = useSelector(selectReadyToBill);
  const { loadPage, loadFacet } = actions;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, search: query.search });
  // A column's facet ignores that column's own filter (the server skips it too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => JSON.stringify({ filters: Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== key)), search: query.search }),
    [query],
  );

  const table = useServerTable<ReadyToBillPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load Ready to Bill.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const total = table.data?.total ?? 0;
  const meta = table.data?.meta;
  const picked = state.filters.stage ?? [];

  const chips = useMemo<FilterChip[]>(
    () => Object.entries(state.filters).flatMap(([key, values]) => values.map((value) => ({ key, label: labelOf(key), value }))),
    [state.filters],
  );

  // Every page under the current filters and sort, in the table's column order.
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const all: ReadyToBillRow[] = [];
      for (let page = 1; ; page++) {
        const res = await loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all.push(...res.data.rows);
        if (all.length >= res.data.total || res.data.rows.length === 0) break;
      }
      downloadCsv("ready_to_bill.csv", toCsv(READY_COLUMNS.map((c) => c.label), all.map((r) => READY_COLUMNS.map((c) => r[c.key as keyof ReadyToBillRow]))));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <GMDUpdateHeader title="READY TO BILL" totalRows={total} syncedAt={syncedAt} warnIfStale />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-3 pb-6">
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Tile label="Ready to bill" value={money(meta?.value ?? 0, total)} hint={`Rs ${formatIndianNumber(meta?.value ?? 0)}: stock held against the line, actuator included`} />
          {READY_STAGES.map((s) => {
            const t = meta?.stages[s] ?? { value: 0, lines: 0 };
            const active = picked.length === 1 && picked[0] === s;
            return (
              <Tile key={s} label={s} value={money(t.value, t.lines)} hint={active ? "Click to show every stage" : "Click to show only these"} active={active}
                onClick={() => dispatch(setFilter({ key: "stage", values: active ? [] : [s] }))} />
            );
          })}
          <Tile label="Parties" value={String(meta?.parties ?? 0)} />
          <Tile label="Contracts" value={String(meta?.contracts ?? 0)} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search contract, party, item, RM code" />
          <FilterChips
            chips={chips}
            onRemove={(chip) => dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => v !== chip.value) }))}
            onClear={() => dispatch(clearFilters())}
          />
          {/* load errors show in the table (with Retry); only the export's own error goes here */}
          {exportError && <span role="alert" className="text-xs text-red-600">{exportError}</span>}
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
              {exporting ? "Exporting…" : "Download Excel (CSV)"}
            </Button>
          </div>
        </div>

        <DataTable
          columns={READY_COLUMNS}
          rows={table.data?.rows ?? []}
          rowId={(r) => r.id}
          sort={state.sort}
          onSortChange={(s) => dispatch(setSort(s))}
          filters={state.filters}
          onFilterChange={(key, values) => dispatch(setFilter({ key, values }))}
          facetOptions={table.getFacetOptions}
          onFacetOpen={(key) => void table.requestFacet(key)}
          selectedId={state.selectedId}
          onSelect={(id) => dispatch(select(id))}
          loading={table.loading}
          refreshing={table.refreshing}
          error={table.error}
          onRetry={() => void table.refresh()}
          hasFilters={chips.length > 0 || Boolean(state.search)}
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
