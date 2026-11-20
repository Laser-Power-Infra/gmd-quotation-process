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
import { CALL_STATUSES, READY_COLUMNS, READY_STAGES, SHARE_HEADER, type ReadyToBillActions, type ReadyToBillPageData } from "../readyToBill";
import { clearFilters, queryOf, select, selectReadyToBill, setFilter, setPage, setPageSize, setSearch, setSort } from "../state/readyToBillSlice";

const labelOf = (key: string) => READY_COLUMNS.find((c) => c.key === key)?.label ?? key;
const money = (v: number, lines: number) => `${formatLakh(v)} · ${lines} lines`;
const INTERNAL = "ready_to_bill.csv", SHARE = "inspection_call_list.csv";

/** Order lines with stock held against them (valve and actuator), one server page at a time. */
export default function ReadyToBillPage({ actions, syncedAt }: { actions: ReadyToBillActions; syncedAt: string | null }) {
  const dispatch = useDispatch();
  const state = useSelector(selectReadyToBill);
  const { loadPage, loadFacet } = actions;
  const [exporting, setExporting] = useState<string | null>(null);
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

  const chips = useMemo<FilterChip[]>(
    () => Object.entries(state.filters).flatMap(([key, values]) => values.map((value) => ({ key, label: labelOf(key), value }))),
    [state.filters],
  );

  // A tile picks one value of its column (stage or alloc status); clicking it again shows every line.
  const tile = (key: string, value: string, t = { value: 0, lines: 0 }) => {
    const active = state.filters[key]?.length === 1 && state.filters[key][0] === value;
    return (
      <Tile key={value} label={value} value={money(t.value, t.lines)} hint={active ? "Click to show every line" : "Click to show only these"} active={active}
        onClick={() => dispatch(setFilter({ key, values: active ? [] : [value] }))} />
    );
  };

  // Both downloads are built on the server from every line under the current filters, not just this page.
  const download = async (file: string, header: string[], load: ReadyToBillActions["loadExport"]) => {
    setExporting(file);
    setExportError(null);
    try {
      const res = await load(query);
      if (!res.success) throw new Error(res.error);
      if (!res.data.length) throw new Error("No line to download under these filters.");
      downloadCsv(file, toCsv(header, res.data));
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <GMDUpdateHeader title="READY TO BILL" totalRows={total} syncedAt={syncedAt} warnIfStale />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-3 pb-6">
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <Tile label="Ready to bill" value={money(meta?.value ?? 0, total)} hint={`Rs ${formatIndianNumber(meta?.value ?? 0)}: stock held against the line, actuator included`} />
          {READY_STAGES.map((s) => tile("stage", s, meta?.stages[s]))}
          {CALL_STATUSES.map((s) => tile("allocStatus", s, meta?.calls[s]))}
          <Tile label="Parties" value={String(meta?.parties ?? 0)} />
          <Tile label="Contracts" value={String(meta?.contracts ?? 0)} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search contract, party, MC no, item, RM code" />
          <FilterChips
            chips={chips}
            onRemove={(chip) => dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }))}
            onClear={() => dispatch(clearFilters())}
          />
          {/* load errors show in the table (with Retry); only the export's own error goes here */}
          {exportError && <span role="alert" className="text-xs text-red-600">{exportError}</span>}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" title="Every column, RM codes and locations included: for internal use"
              onClick={() => void download(INTERNAL, READY_COLUMNS.map((c) => c.label), actions.loadExport)} disabled={!!exporting || !total}>
              {exporting === INTERNAL ? "Exporting…" : "Download Excel (CSV): internal"}
            </Button>
            <Button variant="outline" size="sm"
              title="Lines ready for an inspection call under the current filters: party, contract no, MC no, item, make DALUI and qty ready. No RM codes, locations, supplier, incoming or ETA."
              onClick={() => void download(SHARE, SHARE_HEADER, actions.loadShareList)} disabled={!!exporting || !meta?.calls["Ready for inspection call"].lines}>
              {exporting === SHARE ? "Exporting…" : "Inspection call list (CSV): for sharing"}
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
