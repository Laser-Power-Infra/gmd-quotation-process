"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { Button } from "@gmd/ui/components/button";
import { TD, TDN, TH, Tile } from "@gmd/ui/components/plain-table";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { formatIndianNumber, formatLakh } from "@gmd/ui/lib/format";
import {
  EXPORT_HEADER,
  GLOSSARY,
  ORDER_COLUMNS,
  PENDING_WITH,
  STAGES,
  lightOf,
  producedText,
  type ContractDetail,
  type ContractRow,
  type Light,
  type OrderStatusActions,
  type OrderStatusPageData,
} from "../columns";
import {
  clearFilters,
  queryOf,
  selectOrderStatus,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setShowDone,
  setSort,
} from "../state/tableSlice";

export interface OrderStatusPageProps {
  actions: OrderStatusActions;
}

const LIGHT_CLASS: Record<Light, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-600" };
const LIGHT_TEXT: Record<Light, string> = { green: "On track", amber: "Due soon", red: "Stuck / overdue" };
const list = (a: string[]) => (a.length ? a.join(", ") : "-");
const labelOf = (key: string) => ORDER_COLUMNS.find((c) => c.key === key)?.label ?? key;

/** The cells that show more than their value: the age light, money in lakh, the stage with production progress. */
const COLUMNS: DataColumn<ContractRow>[] = ORDER_COLUMNS.map((c) => {
  if (c.key === "contractNo")
    return {
      ...c,
      render: (r) => {
        const light = lightOf(r.stage, r.days);
        return (
          <span className="flex items-center gap-2">
            <span
              title={`${LIGHT_TEXT[light]}${r.days === null ? "" : ` (${r.days} days since contract)`}`}
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${LIGHT_CLASS[light]}`}
            />
            {r.contractNo}
          </span>
        );
      },
    };
  if (c.key === "value") return { ...c, render: (r) => formatLakh(r.value) };
  if (c.key === "stage") return { ...c, render: (r) => [r.stage, producedText(r)].filter(Boolean).join(" · ") };
  return c;
});

/** Contracts, where each one sits on the way from order to bill, one server page at a time. */
export function OrderStatusPage({ actions }: OrderStatusPageProps) {
  const dispatch = useDispatch();
  const state = useSelector(selectOrderStatus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Drill-downs already loaded (an error message when the load failed), kept while paging.
  const [details, setDetails] = useState<Record<string, ContractDetail | string>>({});
  const [exporting, setExporting] = useState(false);

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

  const table = useServerTable<OrderStatusPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await actions.loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load Order Status.");
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
  const picked = state.filters.stage ?? [];

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const select = async (id: string | null) => {
    setSelectedId(id);
    if (!id || details[id] !== undefined) return;
    const res = await actions.loadContract(id).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : "Failed to load the contract." }));
    setDetails((m) => ({ ...m, [id]: res.success ? res.data : res.error }));
  };

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  // Every line of every contract under the current filters and sort.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await actions.loadExport(query);
      if (!res.success) throw new Error(res.error);
      downloadCsv("order_status.csv", toCsv(EXPORT_HEADER, res.data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <GMDUpdateHeader title="ORDER STATUS" totalRows={total} syncedAt={meta ? meta.syncedAt : undefined} warnIfStale />
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-3 pb-6">
        <div className="grid shrink-0 grid-cols-3 gap-3 md:grid-cols-6">
          {STAGES.map((s) => {
            const active = picked.length === 1 && picked[0] === s;
            return (
              <Tile
                key={s}
                label={s === "Fully billed" ? s : `At ${s}`}
                value={meta ? String(meta.stages[s]) : "–"}
                hint={`${PENDING_WITH[s]}. ${active ? "Click to show every stage." : "Click to filter."}`}
                active={active}
                onClick={() => dispatch(setFilter({ key: "stage", values: active ? [] : [s] }))}
              />
            );
          })}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search contract, party or item" />
          <label className="flex h-8 items-center gap-1.5 text-xs">
            <input type="checkbox" checked={state.showDone} onChange={(e) => dispatch(setShowDone(e.target.checked))} /> Show fully billed
          </label>
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
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
              {exporting ? "Exporting…" : "Download Excel (CSV)"}
            </Button>
          </div>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">Click a contract for its items, the paper trail and the invoices raised against it.</p>

        <DataTable
          columns={COLUMNS}
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
          onSelect={(id) => void select(id)}
          renderDetail={(r) => <Detail detail={details[r.id]} />}
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
        <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
      </div>
    </main>
  );
}

/** Header text with the short form explained on hover. */
function Abbr({ text, hint }: { text: string; hint?: string }) {
  return hint ? <span title={hint} className="cursor-help underline decoration-dotted">{text}</span> : <>{text}</>;
}

/** The paper trail of the selected contract: its lines, then its invoices with their documents. */
function Detail({ detail }: { detail: ContractDetail | string | undefined }) {
  if (detail === undefined) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (typeof detail === "string") return <p className="text-xs text-red-600">{detail}</p>;
  return (
    <div className="text-[12px]">
      <div className="mb-1 text-xs font-semibold">Paper trail: order, production, inspection offer, inspection, dispatch, invoice</div>
      <table className="border-collapse">
        <thead>
          <tr>
            <th className={TH}>Item</th>
            {(["Order qty", "MC", "Prod order", "DI", "Bill"] as const).map((h) => (
              <th key={h} className={`${TH} text-right`}>
                <Abbr text={h === "Order qty" ? h : `${h} qty`} hint={GLOSSARY[h]} />
              </th>
            ))}
            <th className={TH}><Abbr text="Prod order no" hint={GLOSSARY["Prod order"]} /></th>
            <th className={TH}><Abbr text="Inspection offer" hint={GLOSSARY.Offer} /></th>
            <th className={TH}><Abbr text="Inspection no" hint={GLOSSARY.Inspection} /></th>
            <th className={TH}><Abbr text="DI date" hint={GLOSSARY.DI} /></th>
            <th className={TH}>Stage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {detail.lines.map((l) => (
            <tr key={l.id}>
              <td className={TD}>{l.itemCode} {l.itemName}</td>
              {[l.orderQty, l.mcQty, l.prodOrdQty, l.diQty, l.billedQty].map((q, j) => (
                <td key={j} className={TDN}>{formatIndianNumber(q)}</td>
              ))}
              <td className={TD}>{l.productionOrderNumber ?? "-"}</td>
              <td className={TD}>{list(l.offerNumber)}</td>
              <td className={TD}>{list(l.inspectionNumber)}</td>
              <td className={TD}>{list(l.diDate)}</td>
              <td className={TD}>{l.stage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-1 mt-3 text-xs font-semibold">Invoices against this contract</div>
      {detail.invoices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No invoice yet.</p>
      ) : (
        <table className="border-collapse">
          <thead>
            <tr>{["Invoice no", "Date", "Item", "Qty", "Value", "LR no / date", "Documents"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {detail.invoices.map((v, i) => (
              <tr key={`${v.invoiceNo}-${i}`}>
                <td className={TD}>{v.invoiceNo}</td>
                <td className={TD}>{v.date ?? "-"}</td>
                <td className={TD}>{v.itemCode} {v.itemName}</td>
                <td className={TDN}>{v.qty ?? "-"}</td>
                <td className={TDN}>{formatIndianNumber(v.value, 2) || "-"}</td>
                <td className={TD}>{v.lrNoDt ?? "-"}</td>
                <td className={TD}>
                  {([["Order copy", v.orderCopy], ["Invoice", v.invoice], ["Inspection report", v.inspectionReport]] as const)
                    .filter(([, u]) => u && /^https?:\/\//i.test(u))
                    .map(([label, u]) => (
                      <a key={label} href={u!} target="_blank" rel="noreferrer" className="mr-2 text-primary underline">{label}</a>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
