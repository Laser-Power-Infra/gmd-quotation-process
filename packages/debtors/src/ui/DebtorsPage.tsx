"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { BarChart3, Download, X } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatCell } from "@gmd/ui/components/data-table/format";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { formatLakh } from "@gmd/ui/lib/format";
import { cn } from "@gmd/ui/lib/utils";
import { DEBTOR_COLUMNS, LITIGATION_ONLY } from "../columns";
import {
  VIEWS,
  clearFilters,
  queryOf,
  select,
  selectDebtorsTable,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSort,
  setView,
  setWeekOnly,
  toggleAmountFormat,
  toggleBucket,
  type DebtorView,
} from "../state/tableSlice";
import { BUCKET_KEYS, BUCKETS, type Bucket, type DebtorBill, type DebtorPageData, type DebtorPartyRow, type DebtorSummary, type DebtorsActions, type FollowUpHistoryRow } from "../types";

export interface DebtorsPageProps {
  actions: DebtorsActions;
  /** Options of the Legal status editor. */
  legalStatuses: readonly string[];
  /** MSME interest statement PDF of one party; omitted = no link. */
  statementUrl?: (accCode: string) => string;
  /** Host header (title, sync); gets the summary once it has loaded. */
  header?: (summary: DebtorSummary | null) => ReactNode;
}

const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const full = (n: number) => `${n < 0 ? "-" : ""}₹${rupees.format(Math.abs(n))}`;
const date = (v: string | null) => (v ? formatCell(v, "date") : "-");
// shortcut: buckets are 31-60 / 61+, not split at 45, so amber covers 31-60 and red starts at 61, upgrade when the buckets are re-cut at 45
const bucketTone = (b: Bucket) => (b === "31-60" ? "text-amber-700 dark:text-amber-400" : b === "61-90" || b === "91-180" || b === "180+" ? "text-red-700 dark:text-red-400" : "");
const BUCKET_BY_KEY = new Map(BUCKETS.map((b) => [BUCKET_KEYS[b], b]));
const VIEW_LABEL = new Map<string, string>(VIEWS);

export function DebtorsPage({ actions, legalStatuses, statementUrl, header }: DebtorsPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectDebtorsTable);
  const { loadPage, loadFacet, loadSummary, saveField } = actions;
  const fmt = state.amountFormat === "lakh" ? formatLakh : full;

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, dateRanges: query.dateRanges, columnSearch: query.columnSearch, search: query.search, extra: query.extra });
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), dateRanges: omit(query.dateRanges), columnSearch: omit(query.columnSearch), search: query.search, extra: query.extra });
    },
    [query],
  );

  const table = useServerTable<DebtorPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load debtors.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data, refresh } = table;
  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const [summary, setSummary] = useState<DebtorSummary | null>(null);
  const reloadSummary = useCallback(async () => {
    const res = await loadSummary();
    if (res.success) setSummary(res.data);
    else toast.error(res.error);
  }, [loadSummary]);
  useEffect(() => {
    void reloadSummary();
  }, [reloadSummary]);

  const [chartsOpen, setChartsOpen] = useState(false);
  useEffect(() => {
    if (!chartsOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setChartsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartsOpen]);

  const litigationView = state.view === "litigation";
  const columns = useMemo<DataColumn<DebtorPartyRow>[]>(
    () =>
      DEBTOR_COLUMNS.filter((c) => litigationView || !LITIGATION_ONLY.has(c.key)).map((c) => {
        const base: DataColumn<DebtorPartyRow> = { key: c.key, label: c.label, kind: c.kind, filter: c.filter, sortable: c.sortable, edit: c.edit, width: c.width, align: c.kind === "number" ? "right" : undefined };
        if (c.key === "accName") return { ...base, sticky: true, render: (r) => <span className="font-medium" title={r.accCode}>{r.accName}</span> };
        if (c.key === "legalStatus") return { ...base, options: legalStatuses };
        if (c.edit) return base; // editors show the stored text
        if (c.key === "msmeStage" || c.key === "msmeDays") return { ...base, render: (r) => String(r[c.key as "msmeStage" | "msmeDays"] ?? "-") };
        if (c.key === "promise") return { ...base, render: (r) => <span className={r.promise === "Missed" ? "font-semibold text-red-700 dark:text-red-400" : ""}>{r.promise ?? "-"}</span> };
        const bucket = BUCKET_BY_KEY.get(c.key);
        return {
          ...base,
          render: (r) => {
            const v = Number(r[c.key as keyof DebtorPartyRow] ?? 0);
            if (!v && c.key !== "totalDues" && c.key !== "net") return "-";
            const text = fmt(c.key === "msmeInterest" || c.key === "msmeClaimable" ? Math.round(v) : v);
            return bucket && v > 0 && bucketTone(bucket) ? <span className={cn("font-semibold", bucketTone(bucket))}>{text}</span> : text;
          },
        };
      }),
    [litigationView, legalStatuses, fmt],
  );

  const onEdit = useCallback(
    async (row: DebtorPartyRow, column: DataColumn<DebtorPartyRow>, value: string) => {
      const toastId = toast.loading(`Saving ${column.label}…`);
      const res = await saveField(row, column.key, value);
      if (!res.success) {
        toast.error(res.error || `Could not save ${column.label}`, { id: toastId });
        return false;
      }
      toast.success(`${column.label} saved`, { id: toastId });
      // Stage, promise and the collectable split follow the edited value.
      void refresh();
      void reloadSummary();
      return true;
    },
    [saveField, refresh, reloadSummary],
  );

  const chips = useMemo<FilterChip[]>(() => {
    const label = (key: string) => columns.find((c) => c.key === key)?.label ?? key;
    const out: FilterChip[] = [];
    if (state.view !== "all") out.push({ key: "__view", label: "View", value: VIEW_LABEL.get(state.view) ?? state.view });
    if (state.bucket) out.push({ key: "__bucket", label: "Ageing", value: state.bucket === "Not due" ? state.bucket : `${state.bucket} days` });
    if (state.weekOnly) out.push({ key: "__week", label: "Promised", value: "this week" });
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: label(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: label(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: label(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state, columns]);
  const removeChip = (chip: FilterChip) => {
    if (chip.key === "__view") return dispatch(setView("all"));
    if (chip.key === "__bucket") return state.bucket && dispatch(toggleBucket(state.bucket));
    if (chip.key === "__week") return dispatch(setWeekOnly(false));
    if (chip.date) return dispatch(setDateRange({ key: chip.key, range: undefined }));
    if (chip.search) return dispatch(setColumnSearch({ key: chip.key, value: "" }));
    dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }));
  };
  const hasFilters = chips.length > 0;

  const total = data?.total ?? 0;
  const totals = data?.meta?.totals;

  // Every page under the current filters and sort, in the on-screen column order.
  const [exporting, setExporting] = useState(false);
  const exportXlsx = useCallback(async () => {
    setExporting(true);
    try {
      const all: DebtorPartyRow[] = [];
      for (let page = 1; ; page++) {
        const res = await loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all.push(...res.data.rows);
        if (all.length >= res.data.total || res.data.rows.length === 0) break;
      }
      const cell = (r: DebtorPartyRow, key: string) => {
        const v = r[key as keyof DebtorPartyRow];
        return key === "msmeInterest" || key === "msmeClaimable" ? Math.round(Number(v)) : v;
      };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([columns.map((c) => c.label), ...all.map((r) => columns.map((c) => cell(r, c.key)))]), "Debtors");
      XLSX.writeFile(wb, "debtors_party_wise.xlsx");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [loadPage, query, columns]);

  if (summary && summary.ledgerRows === 0) {
    return (
      <>
        {header?.(summary)}
        <p className="m-6 rounded-lg border border-border bg-card py-16 text-center text-sm font-medium text-muted-foreground">No debtors data synced yet. Use Sync to pull the ledger.</p>
      </>
    );
  }

  return (
    <>
      {header?.(summary)}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 px-6 pb-6 lg:flex-row">
        <SummaryRail summary={summary} fmt={fmt} bucket={state.bucket} weekOnly={state.weekOnly} view={state.view} stageFilter={state.filters.msmeStage}
          onBucket={(b) => dispatch(toggleBucket(b))}
          onWeek={() => dispatch(setWeekOnly(!state.weekOnly))}
          onLitigation={() => dispatch(setView(litigationView ? "all" : "litigation"))}
          onStage={(s) => dispatch(setFilter({ key: "msmeStage", values: state.filters.msmeStage?.[0] === s ? [] : [s] }))}
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
              View
              <select
                value={state.view}
                onChange={(e) => dispatch(setView(e.target.value as DebtorView))}
                className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
              >
                {VIEWS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <FilterChips chips={chips} onRemove={removeChip} onClear={() => dispatch(clearFilters())} />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => dispatch(toggleAmountFormat())} aria-label={state.amountFormat === "lakh" ? "Show amounts in full rupees" : "Show amounts in lakh"}>
                {state.amountFormat === "lakh" ? "₹ L" : "₹"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportXlsx()} disabled={exporting || !total}>
                <Download />
                {exporting ? "Exporting…" : "Excel"}
              </Button>
              <Button variant="outline" size="sm" aria-expanded={chartsOpen} aria-controls="debtor-charts" onClick={() => setChartsOpen((o) => !o)} className={cn(chartsOpen && "border-primary bg-primary/10")}>
                <BarChart3 />
                Top 10 overdue
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={data?.rows ?? []}
            rowId={(r) => r.accCode}
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
            onEdit={onEdit}
            renderDetail={(row) => <PartyDetail row={row} bucket={state.bucket} actions={actions} statementUrl={statementUrl} />}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {totals && (
              <p className="text-xs tabular-nums text-muted-foreground">
                {rupees.format(total)} parties: dues <span className="font-semibold text-foreground">{fmt(totals.totalDues)}</span>, overdue{" "}
                <span className="font-semibold text-foreground">{fmt(totals.overdue)}</span>, net <span className="font-semibold text-foreground">{fmt(totals.net)}</span>, BG{" "}
                <span className="font-semibold text-foreground">{fmt(totals.bg)}</span>
              </p>
            )}
            <div className="ml-auto">
              <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
            </div>
          </div>
        </section>

        {/* Floats over the table's right edge so the table never reflows when the chart opens. */}
        {chartsOpen && (
          <section id="debtor-charts" aria-label="Top 10 clients by overdue" className="absolute inset-y-0 right-6 z-30 flex w-[calc(100%-3rem)] max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-8">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-foreground">Top 10 clients by overdue</h2>
              <button type="button" aria-label="Close chart" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setChartsOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="px-4 pt-2 text-xs text-muted-foreground">Click a client to filter the table to it. Parties under litigation are left out.</p>
            {summary?.top10.length ? (
              <ul className="min-h-0 flex-1 space-y-2.5 overflow-auto px-4 py-3">
                {summary.top10.map((p) => {
                  const on = state.columnSearch.accName === p.accName;
                  return (
                  <li key={p.accCode}>
                    <button type="button" aria-pressed={on} onClick={() => dispatch(setColumnSearch({ key: "accName", value: on ? "" : p.accName }))} className={cn("w-full rounded px-1.5 py-1 text-left hover:bg-accent", on && "bg-primary/10")}>
                      <span className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate" title={p.accName}>{p.accName}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{fmt(p.overdue)}</span>
                      </span>
                      <span className="mt-1 block h-2 rounded-sm bg-muted">
                        <span className="block h-2 rounded-sm bg-red-600/80 dark:bg-red-400/80" style={{ width: `${(p.overdue / summary.top10[0].overdue) * 100}%` }} />
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">{summary ? "No overdue parties." : "Loading…"}</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Sidebar row: label over value, rows split by hairlines instead of separate cards.
function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="px-4 py-2">
      <div className="text-xs leading-snug text-muted-foreground">{label}</div>
      <div className={cn("text-lg leading-tight font-semibold tabular-nums", danger ? "text-red-700 dark:text-red-400" : "text-foreground")}>{value}</div>
    </div>
  );
}
const RAIL_GROUP = "divide-y divide-border/60 border-b border-border pb-1";
const RAIL_HEAD = "px-4 pt-3 pb-1 text-[13px] font-semibold text-foreground";
const railButton = (on: boolean) => cn("block w-full border-l-2 text-left hover:bg-accent", on ? "border-primary bg-primary/10" : "border-transparent");

interface SummaryRailProps {
  summary: DebtorSummary | null;
  fmt: (n: number) => string;
  bucket: Bucket | null;
  weekOnly: boolean;
  view: DebtorView;
  stageFilter?: string[];
  onBucket: (b: Bucket) => void;
  onWeek: () => void;
  onLitigation: () => void;
  onStage: (stage: string) => void;
}

function SummaryRail({ summary: s, fmt, bucket, weekOnly, view, stageFilter, onBucket, onWeek, onLitigation, onStage }: SummaryRailProps) {
  const v = (n: number | undefined) => (s ? fmt(n ?? 0) : "…");
  return (
    <aside aria-label="Debtor totals" className="shrink-0 overflow-auto rounded-xl border border-border bg-card lg:w-64">
      <h2 className={RAIL_HEAD}>Receivables</h2>
      <div className={RAIL_GROUP}>
        <Stat label="Total dues" value={v(s?.totalDues)} />
        <Stat label="Overdue" value={v(s?.overdue)} />
        <Stat label="Over 90 days" value={v(s?.over90)} danger />
        <Stat label={`Unadjusted credits / advances (net ${v(s?.net)})`} value={v(s?.credits)} />
        <Stat label="No. of parties" value={s ? String(s.parties) : "…"} />
        <button type="button" aria-pressed={weekOnly} onClick={onWeek} className={railButton(weekOnly)}>
          <Stat label={`Promised this week (${s?.promised.count ?? 0} parties)`} value={v(s?.promised.total)} />
        </button>
      </div>

      <h2 className={RAIL_HEAD}>Collectability</h2>
      <div className={RAIL_GROUP}>
        <Stat label="Gross dues" value={v(s?.split.gross)} />
        <button type="button" aria-pressed={view === "litigation"} onClick={onLitigation} className={railButton(view === "litigation")}>
          <Stat label="Under litigation (after provision)" value={v(s?.split.underLitigation)} danger />
        </button>
        <Stat label="Provision for doubtful debts" value={v(s?.split.provision)} />
        <Stat label="Net collectable" value={v(s?.split.netCollectable)} />
      </div>

      <h2 className={RAIL_HEAD}>Ageing (click to filter)</h2>
      <div className={RAIL_GROUP}>
        {BUCKETS.map((b) => (
          <button key={b} type="button" aria-pressed={bucket === b} onClick={() => onBucket(b)} className={cn(railButton(bucket === b), "flex items-baseline justify-between gap-3 px-4 py-2")}>
            <span className="text-xs text-muted-foreground">{b === "Not due" ? b : `${b} days`}</span>
            <span className={cn("text-sm font-semibold tabular-nums", bucketTone(b))}>{v(s?.buckets[b])}</span>
          </button>
        ))}
      </div>

      <h2 className={RAIL_HEAD}>Follow-up stage</h2>
      <div className="divide-y divide-border/60 pb-1">
        {(s?.stages ?? []).map((st) => {
          const on = stageFilter?.length === 1 && stageFilter[0] === String(st.stage);
          return (
            <button key={st.stage} type="button" aria-pressed={on} onClick={() => onStage(String(st.stage))} className={cn(railButton(on), "flex items-baseline justify-between gap-3 px-4 py-2")}>
              <span className="text-xs text-muted-foreground">Stage {st.stage} ({st.count})</span>
              <span className="text-sm font-semibold tabular-nums">{fmt(st.value)}</span>
            </button>
          );
        })}
        {s && s.stages.length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">No parties past an MSME due date.</p>}
      </div>
    </aside>
  );
}

const STATEMENT_HEADER = ["Invoice no", "Date", "Order no", "PO ref", "Items", "Amount", "Allocated", "Balance", "Due date", "Days overdue", "Credit note"];
const money2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TH = "border-b border-border px-3 py-1.5 text-left font-semibold whitespace-nowrap";
const TD = "px-3 py-1.5 whitespace-nowrap";

/** Drill-down under the selected party: open bills, statement downloads, follow-up history. */
function PartyDetail({ row, bucket, actions, statementUrl }: { row: DebtorPartyRow; bucket: Bucket | null; actions: DebtorsActions; statementUrl?: (accCode: string) => string }) {
  const [bills, setBills] = useState<DebtorBill[] | null>(null);
  const [history, setHistory] = useState<FollowUpHistoryRow[] | null>(null);
  const { loadBills, loadHistory } = actions;
  useEffect(() => {
    let live = true;
    void loadBills(row.accCode, bucket).then((res) => live && (res.success ? setBills(res.data) : toast.error(res.error)));
    void loadHistory(row.accCode).then((res) => live && (res.success ? setHistory(res.data) : toast.error("Could not load the follow-up history.")));
    return () => {
      live = false;
    };
  }, [row.accCode, bucket, loadBills, loadHistory]);

  const statementRows = () => (bills ?? []).map((b) => [b.vrNo, date(b.vrDate), b.orderNo, b.poRef, b.items, b.drAmt, b.drAllocAmt, b.bal, date(b.dueDate), b.days, b.creditNote]);
  const name = `statement_${row.accName.replace(/[^A-Za-z0-9]+/g, "_")}`;
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    download(new Blob(["﻿" + [STATEMENT_HEADER, ...statementRows()].map((r) => r.map(esc).join(",")).join("\r\n")], { type: "text/csv" }), `${name}.csv`);
  };
  // Party name on top so the sheet can be attached to a client reminder as-is.
  const exportXlsx = () => {
    const ws = XLSX.utils.aoa_to_sheet([[`Statement of outstanding: ${row.accName}`], [`As on ${date(new Date().toISOString())}`], [], STATEMENT_HEADER, ...statementRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Statement");
    XLSX.writeFile(wb, `${name}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-foreground">Open bills of {row.accName}{bucket ? ` (${bucket === "Not due" ? bucket : `${bucket} days`})` : ""}</h3>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!bills?.length}>Statement CSV</Button>
        <Button variant="outline" size="sm" onClick={exportXlsx} disabled={!bills?.length}>Statement Excel</Button>
        {statementUrl && !row.litigating && (
          <a className="text-xs text-primary underline" href={statementUrl(row.accCode)} target="_blank" rel="noreferrer">MSME interest statement (PDF)</a>
        )}
      </div>
      {bills === null ? (
        <p className="text-muted-foreground">Loading bills…</p>
      ) : bills.length === 0 ? (
        <p className="text-muted-foreground">No open bills.</p>
      ) : (
        <table className="border-collapse">
          <thead>
            <tr>
              {[...STATEMENT_HEADER, "Documents"].map((h, i) => (
                <th key={h} className={cn(TH, i >= 5 && i <= 9 && i !== 8 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {bills.map((b) => (
              <tr key={b.id}>
                <td className={TD}>{b.vrNo ?? "-"}</td>
                <td className={TD}>{date(b.vrDate)}</td>
                <td className={TD}>{b.orderNo ?? "-"}</td>
                <td className={TD}>{b.poRef ?? "-"}</td>
                <td className={cn(TD, "max-w-64 truncate")} title={b.items ?? undefined}>{b.items ?? "-"}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{b.drAmt === null ? "-" : money2.format(b.drAmt)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{b.drAllocAmt === null ? "-" : money2.format(b.drAllocAmt)}</td>
                <td className={cn(TD, "text-right tabular-nums", b.bal < 0 && "text-green-700 dark:text-green-400")}>{money2.format(b.bal)}{b.bal < 0 ? " (credit)" : ""}</td>
                <td className={TD}>{date(b.dueDate)}</td>
                <td className={cn(TD, "text-right tabular-nums", b.days !== null && b.days > 45 ? "font-semibold text-red-700 dark:text-red-400" : b.days !== null && b.days > 30 ? "font-semibold text-amber-700 dark:text-amber-400" : "")}>{b.days ?? "-"}</td>
                <td className={TD}>{b.creditNote || "-"}</td>
                <td className={TD}>
                  {b.links.length === 0
                    ? "-"
                    : b.links.map((l) =>
                        /^https?:\/\//i.test(l.value) ? (
                          <a key={l.label} href={l.value} target="_blank" rel="noreferrer" className="mr-2 text-primary underline">{l.label}</a>
                        ) : (
                          <span key={l.label} className="mr-2">{l.label}: {l.value}</span>
                        ),
                      )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="font-semibold text-foreground">Follow-up history</h3>
      {history === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-muted-foreground">No follow-ups saved yet.</p>
      ) : (
        <table className="border-collapse">
          <thead>
            <tr>
              {["Saved on", "Owner", "Last follow-up", "Promised date", "Promised amount", "Next action", "Status", "Remarks"].map((h) => (
                <th key={h} className={cn(TH, h === "Promised amount" && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {history.map((h, i) => (
              <tr key={i}>
                <td className={TD}>{new Date(h.changedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className={TD}>{h.owner ?? "-"}</td>
                <td className={TD}>{date(h.lastFollowUp)}</td>
                <td className={TD}>{date(h.promisedDate)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{h.promisedAmount ? money2.format(Number(h.promisedAmount)) : "-"}</td>
                <td className={TD}>{date(h.nextActionDate)}</td>
                <td className={TD}>{h.status ?? "-"}</td>
                <td className={TD}>{h.remarks ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
