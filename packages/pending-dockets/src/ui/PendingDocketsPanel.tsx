"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AlertCircle, CheckCircle2, Clock, Download, ExternalLink, FileSpreadsheet, FileText, Layers, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import { formatCell } from "@gmd/ui/components/data-table/format";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { cn } from "@gmd/ui/lib/utils";
import { PENDING_COLUMNS, type PendingAttachment, type PendingDocketRow, type PendingDocketsActions, type PendingDocketsPage, type PendingThread } from "../columns";
import {
  clearFilters,
  queryOf,
  selectPendingDockets,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from "../state/tableSlice";

export interface PendingDocketsPanelProps {
  actions: PendingDocketsActions;
  /** Bump to reload in the background (after a sync or the page's Refresh button). */
  refreshKey?: number;
  /** Every pending request before filters, each time a page loads (the tab badge). */
  onCount?: (all: number) => void;
}

/** While AI verdicts are still coming, reload quietly every 10 s, at most 30 times in a row. */
const POLL_MS = 10_000;
const MAX_POLLS = 30;

const n = new Intl.NumberFormat("en-IN");

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

const Badge = ({ className, title, children }: { className: string; title?: string; children: ReactNode }) => (
  <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", className)}>
    {children}
  </span>
);

function FileIcon({ name, className }: { name: string; className?: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return <FileText className={cn("shrink-0 text-rose-500 dark:text-rose-300", className)} />;
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return <FileSpreadsheet className={cn("shrink-0 text-emerald-500 dark:text-emerald-300", className)} />;
  return <Paperclip className={cn("shrink-0 text-blue-500 dark:text-blue-300", className)} />;
}

const FileChip = ({ file }: { file: PendingAttachment }) => (
  <span className="mr-1 inline-flex max-w-44 items-center gap-1 rounded border border-border/80 bg-muted/70 px-1.5 py-0.5 align-middle text-[11px]">
    <FileIcon name={file.name} className="size-3" />
    <span className="truncate" title={file.name}>
      {file.name}
    </span>
    {file.link && (
      <a
        href={file.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Open ${file.name}`}
        title="Open / download"
        className="shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
      >
        <ExternalLink className="size-3" />
      </a>
    )}
  </span>
);

const RENDER: Partial<Record<string, (r: PendingDocketRow) => ReactNode>> = {
  date: (r) =>
    r.date ? (
      <>
        <span className="font-medium">{formatCell(r.date, "date")}</span>
        <span className="text-xs text-muted-foreground"> · {age(r.date)}</span>
      </>
    ) : (
      "N/A"
    ),
  requester: (r) => (
    <span className="font-medium" title={r.email ? `${r.requester} <${r.email}>` : r.requester}>
      {r.requester}
    </span>
  ),
  senderType: (r) => (
    <Badge
      className={
        r.senderType === "Team"
          ? "border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-300"
          : "border-purple-200 bg-purple-100 text-purple-700 dark:border-purple-500/25 dark:bg-purple-500/15 dark:text-purple-300"
      }
    >
      {r.senderType}
    </Badge>
  ),
  email: (r) => (
    <span className="font-mono text-xs text-muted-foreground" title={r.email}>
      {r.email}
    </span>
  ),
  files: (r) =>
    r.attachments.length === 0 ? (
      <span className="text-xs text-muted-foreground italic">No files</span>
    ) : (
      <>
        {r.attachments.slice(0, 2).map((f, i) => (
          <FileChip key={i} file={f} />
        ))}
        {r.attachments.length > 2 && <span className="text-[11px] font-semibold text-muted-foreground">+{r.attachments.length - 2} more</span>}
      </>
    ),
  aiCheck: (r) =>
    r.aiCheck === "Verified" ? (
      <Badge className="border-emerald-300/60 bg-emerald-100 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        Verified
      </Badge>
    ) : r.aiCheck === "Verifying" ? (
      <Badge className="border-amber-300/60 bg-amber-100 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300">
        <Clock className="size-3 animate-pulse motion-reduce:animate-none" />
        Verifying… ({r.aiNote})
      </Badge>
    ) : (
      <Badge title={r.aiNote ?? undefined} className="border-rose-300/60 bg-rose-100 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-300">
        <AlertCircle className="size-3" />
        Not verified
      </Badge>
    ),
  snippet: (r) => (
    <span className="text-xs text-muted-foreground" title={r.snippet}>
      {r.snippet || "No text content preview available."}
    </span>
  ),
};

const COLUMNS: DataColumn<PendingDocketRow>[] = PENDING_COLUMNS.map((c) => (RENDER[c.key] ? { ...c, render: RENDER[c.key] } : c));

const TONES = {
  plain: { box: "border-border/80 bg-card", icon: "bg-purple-500/10 text-purple-600 dark:text-purple-400", text: "text-foreground" },
  rose: { box: "border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20", icon: "bg-rose-500/15 text-rose-600 dark:text-rose-400", text: "text-rose-700 dark:text-rose-400" },
  amber: { box: "border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20", icon: "bg-amber-500/15 text-amber-600 dark:text-amber-400", text: "text-amber-700 dark:text-amber-400" },
  blue: { box: "border-blue-200 bg-blue-50/40 dark:border-blue-900/40 dark:bg-blue-950/20", icon: "bg-blue-500/15 text-blue-600 dark:text-blue-400", text: "text-blue-700 dark:text-blue-400" },
};

interface TileProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  tone: keyof typeof TONES;
  /** Tiles with a toggle filter the table to their rows. */
  pressed?: boolean;
  onToggle?: () => void;
}

function Tile({ icon: Icon, label, value, tone, pressed, onToggle }: TileProps) {
  const t = TONES[tone];
  const body = (
    <>
      <span className={cn("shrink-0 rounded-md p-1.5", t.icon)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 text-left">
        <span className={cn("block text-[9px] font-bold tracking-wider uppercase", tone === "plain" ? "text-muted-foreground" : t.text)}>{label}</span>
        <span className={cn("block text-base leading-tight font-bold tabular-nums", t.text)}>{value === undefined ? "…" : n.format(value)}</span>
      </span>
    </>
  );
  const box = cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 shadow-2xs", t.box);
  if (!onToggle) return <div className={box}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      title={pressed ? "Show every request again" : `Show only: ${label}`}
      className={cn(box, "outline-none transition-shadow hover:ring-1 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring/50", pressed && "ring-2 ring-primary/60")}
    >
      {body}
    </button>
  );
}

const CSV_HEADER = ["Date", "Requester Name", "Requester Email", "Subject", "Tender / GeM Ref", "Mail Type", "Docket in DB", "Msg Count", "Status", "Attachments", "Snippet"];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The Pending Dockets tab: KPI tiles, search, header filters, the paged table and the thread under a clicked row. */
export function PendingDocketsPanel({ actions, refreshKey = 0, onCount }: PendingDocketsPanelProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectPendingDockets);
  const { loadPage, loadFacet, loadThread } = actions;
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

  const table = useServerTable<PendingDocketsPage>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load pending dockets.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data, refresh } = table;
  const meta = data?.meta;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);
  useEffect(() => {
    if (meta) onCount?.(meta.all);
  }, [meta, onCount]);
  // Only a bump after mount reloads: mounting already loads.
  const seenRefresh = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === seenRefresh.current) return;
    seenRefresh.current = refreshKey;
    void refresh();
  }, [refreshKey, refresh]);

  // Verdicts land one by one in the background; reload until none are left (or MAX_POLLS).
  const polls = useRef(0);
  useEffect(() => {
    if (!meta?.aiEnabled || !meta.aiPending) {
      polls.current = 0;
      return;
    }
    if (polls.current >= MAX_POLLS) return;
    const id = setTimeout(() => {
      polls.current += 1;
      void refresh();
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [meta, refresh]);

  const commitSearch = useCallback((value: string) => dispatch(setSearch(value)), [dispatch]);
  const only = (key: string, value: string) => state.filters[key]?.length === 1 && state.filters[key][0] === value;
  const toggleOnly = (key: string, value: string) => dispatch(setFilter({ key, values: only(key, value) ? [] : [value] }));

  const chips = useMemo<FilterChip[]>(() => {
    const labelOf = (key: string) => PENDING_COLUMNS.find((c) => c.key === key)?.label ?? key;
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  // Every page under the current filters and sort, in the columns of the old CSV export.
  const [exporting, setExporting] = useState(false);
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const all: PendingDocketRow[] = [];
      for (let page = 1; ; page++) {
        const res = await loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all.push(...res.data.rows);
        if (all.length >= res.data.total || res.data.rows.length === 0) break;
      }
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = all.map((r) => [
        r.date ? new Date(r.date).toLocaleDateString("en-IN") : "",
        r.requester,
        r.email,
        r.subject,
        r.tenderRef,
        r.mailType,
        "", // every row on this tab is still waiting for its docket
        r.msgCount,
        "PENDING_DOCKET",
        r.attachments.map((a) => a.name).join("; "),
        r.snippet.replace(/\n/g, " "),
      ]);
      const csv = [CSV_HEADER, ...rows].map((r) => r.map(esc).join(",")).join("\n");
      download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), `Pending_Dockets_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [loadPage, query]);

  return (
    <>
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile icon={Layers} label="Total requests" value={meta && total} tone="plain" />
        <Tile icon={AlertCircle} label="Not verified" value={meta?.kpi.notVerified} tone="rose" pressed={only("aiCheck", "Not verified")} onToggle={() => toggleOnly("aiCheck", "Not verified")} />
        <Tile icon={Clock} label="Verifying" value={meta?.kpi.verifying} tone="amber" pressed={only("aiCheck", "Verifying")} onToggle={() => toggleOnly("aiCheck", "Verifying")} />
        <Tile icon={Paperclip} label="With files" value={meta?.kpi.withFiles} tone="blue" pressed={only("files", "Yes")} onToggle={() => toggleOnly("files", "Yes")} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField value={state.search} onCommit={commitSearch} busy={table.refreshing} placeholder="Search subject, tender, requester, files, mail text" className="w-80" />
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
        <div className="ml-auto flex items-center gap-3">
          {meta && (
            <span className="text-xs text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{n.format(total)}</span> of {n.format(meta.all)} pending requests
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
            <Download />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable
          columns={COLUMNS}
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
          renderDetail={(row) => <ThreadDetail row={row} loadThread={loadThread} />}
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
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Click a request to read its mail thread and open its files.</p>
        <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
      </div>
    </>
  );
}

const INFO = "text-[10px] font-semibold text-muted-foreground uppercase";

/** The opened request: who and when, its files, and the whole conversation (loaded on open). */
function ThreadDetail({ row, loadThread }: { row: PendingDocketRow; loadThread: PendingDocketsActions["loadThread"] }) {
  const [thread, setThread] = useState<PendingThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadThread(row.id).then((res) => {
      if (!live) return;
      if (res.success) setThread(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [row.id, loadThread]);

  return (
    <div className="flex max-h-[60vh] w-[min(64rem,85vw)] flex-col gap-3 overflow-auto pr-1 text-xs">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold whitespace-normal text-foreground">{row.subject}</h3>
          {row.tenderRef && (
            <span className="rounded border border-amber-300/60 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-300">
              {row.tenderRef}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-muted-foreground">
          From: <strong className="text-foreground">{row.requester}</strong>
          {row.email && ` (${row.email})`} · Date: {row.date ? new Date(row.date).toLocaleString("en-IN") : "N/A"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-border bg-card p-3 sm:grid-cols-4">
        <div>
          <span className={INFO}>Docket in DB</span>
          <div className="font-mono font-bold text-foreground">None (Pending)</div>
        </div>
        <div>
          <span className={INFO}>Mail type</span>
          <div className="font-semibold text-foreground">{row.mailType}</div>
        </div>
        <div>
          <span className={INFO}>Laserentry reply</span>
          <div className={cn("font-semibold", thread?.replied ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
            {thread ? (thread.replied ? "Replied" : "No Reply Received") : "…"}
          </div>
        </div>
        <div>
          <span className={INFO}>Messages in thread</span>
          <div className="font-semibold text-foreground">{row.msgCount} messages</div>
        </div>
      </div>

      {row.attachments.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 font-bold tracking-wide text-foreground uppercase">
            <Paperclip className="size-3.5 text-blue-600 dark:text-blue-300" />
            Attached files ({row.attachments.length})
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {row.attachments.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <FileIcon name={f.name} className="size-4" />
                  <span className="truncate font-medium text-foreground" title={f.name}>
                    {f.name}
                  </span>
                </span>
                {f.link ? (
                  <a
                    href={f.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/20"
                  >
                    <Download className="size-3" />
                    Open
                  </a>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground italic">Internal storage</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <h4 className="flex items-center gap-1.5 font-bold tracking-wide text-foreground uppercase">
          <Layers className="size-3.5 text-purple-600 dark:text-purple-300" />
          Conversation thread{thread && ` (${thread.messages.length} messages)`}
        </h4>
        {error ? (
          <p className="text-rose-600 dark:text-rose-300">{error}</p>
        ) : !thread ? (
          <p className="text-muted-foreground">Loading the conversation…</p>
        ) : (
          thread.messages.map((m, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border bg-card p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 border-b border-border/60 pb-1.5 font-bold text-foreground">
                <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px]">{m.num}</span>
                {m.sender}
              </div>
              <div className="leading-relaxed whitespace-pre-wrap text-foreground/90">{m.body}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
