"use client";

import { useCallback, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "@gmd/ui/components/button";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import {
  ALLOCATION_COLUMNS, LOT_COLUMNS, NEEDS_CONFIRMATION, type AllocationViewRow, type PurchaseViewActions, type PurchaseViewKey, type PurchaseViewPage, type PurchaseViewRow,
} from "../purchaseView";
import { clearFilters, queryOf, select, selectPurchaseView, setFilter, setPage, setPageSize, setSearch, setSort } from "../state/purchaseViewSlice";
import type { NewPurchaseAllocation } from "../types";

const input = "rounded border border-border bg-background px-2 py-1 text-xs";
const AMBER = "rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
const blank = { poNo: "", poLineNo: "", contractNo: "", itemCode: "", qty: "", lot: "", tinaInvoiceNo: "", blNo: "", eta: "", remarks: "", needsConfirmation: false };

const confirmCell = <R extends { confirm: string }>(r: R) => (r.confirm ? <span className={AMBER} title="Not final: confirm with Puja">{NEEDS_CONFIRMATION}</span> : null);

/** The page's writes: each runs through the parent's `write` (which reloads the engine figures) and returns whether it worked. */
export interface PurchaseWrites {
  write(id: string, fn: () => Promise<{ success: boolean; error?: string }>): Promise<boolean>;
  add(input: NewPurchaseAllocation): Promise<{ success: boolean; error?: string }>;
  update(id: string, qty: number): Promise<{ success: boolean; error?: string }>;
  remove(id: string): Promise<{ success: boolean; error?: string }>;
}

/** The purchase allocations (per-line sources, add / edit qty / remove) or the lot-wise table, one server page at a time. */
export default function PurchaseViews({ view, actions, writes, busy, version }: {
  view: PurchaseViewKey; actions: PurchaseViewActions; writes: PurchaseWrites; busy: string | null;
  /** Bumps when the parent's engine output reloads, so this table reloads with it. */
  version: number;
}) {
  const dispatch = useDispatch();
  const state = useSelector(selectPurchaseView)[view];
  const { loadPurchaseViewPage, loadPurchaseViewFacet } = actions;
  const [form, setForm] = useState(blank);
  const [qtyEdit, setQtyEdit] = useState<Record<string, string>>({});

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify({ query, version });
  const filterKey = JSON.stringify({ filters: query.filters, search: query.search, version });
  const facetKey = useCallback(
    (key: string) => JSON.stringify({ filters: Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== key)), search: query.search, version }),
    [query, version],
  );
  const table = useServerTable<PurchaseViewPage>({
    queryKey, filterKey, facetKey,
    fetchPage: async () => {
      const res = await loadPurchaseViewPage(view, query);
      if (!res.success) throw new Error(res.error || "Failed to load purchase lines.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadPurchaseViewFacet(view, key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const total = table.data?.total ?? 0;

  const columns = useMemo<DataColumn<PurchaseViewRow>[]>(() => {
    if (view === "lots") return LOT_COLUMNS.map((c) => (c.key === "confirm" ? { ...c, render: confirmCell } : c)) as DataColumn<PurchaseViewRow>[];
    const cols = ALLOCATION_COLUMNS.map((c) => (c.key === "confirm" ? { ...c, render: confirmCell } : c));
    // Locked or sheet-sourced rows change through these same actions (the log records who).
    const edit: DataColumn<AllocationViewRow> = {
      key: "_edit", label: "Edit qty / remove", kind: "text", width: 230,
      render: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input className={`${input} w-20`} type="number" min={0} value={qtyEdit[r.id] ?? r.qty} aria-label={`Qty for ${r.contractNo} ${r.itemCode} from ${r.purchaseLine}`}
            onChange={(e) => setQtyEdit({ ...qtyEdit, [r.id]: e.target.value })} />
          {qtyEdit[r.id] !== undefined && (
            <button type="button" disabled={busy === r.id} className="text-xs text-primary underline"
              onClick={async () => { if (await writes.write(r.id, () => writes.update(r.id, Number(qtyEdit[r.id])))) setQtyEdit(({ [r.id]: _, ...rest }) => rest); }}>Save</button>
          )}
          <button type="button" disabled={busy === r.id} className="ml-1 text-xs text-red-600 underline"
            onClick={() => confirm(`Remove ${r.contractNo} / ${r.itemCode} from ${r.purchaseLine}?`) && writes.write(r.id, () => writes.remove(r.id))}>Remove</button>
        </span>
      ),
    };
    return [...cols, edit] as DataColumn<PurchaseViewRow>[];
  }, [view, qtyEdit, busy, writes]);

  const chips = useMemo<FilterChip[]>(
    () => Object.entries(state.filters).flatMap(([key, values]) => values.map((value) => ({ key, label: columns.find((c) => c.key === key)?.label ?? key, value }))),
    [state.filters, columns],
  );

  const add = async () => {
    const t = (v: string) => v.trim() || null;
    const ok = await writes.write("add-purchase", () => writes.add({
      poNo: form.poNo.trim(), poLineNo: form.poLineNo.trim(), contractNo: form.contractNo.trim(), itemCode: form.itemCode.trim(), qty: Number(form.qty),
      lot: t(form.lot), tinaInvoiceNo: t(form.tinaInvoiceNo), blNo: t(form.blNo), eta: t(form.eta), needsConfirmation: form.needsConfirmation, remarks: t(form.remarks),
    }));
    if (ok) setForm({ ...form, poLineNo: "", contractNo: "", itemCode: "", qty: "", remarks: "" });
  };
  const f = (key: keyof typeof blank, placeholder: string, w = "w-28") => (
    <input className={`${input} ${w}`} placeholder={placeholder} value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
  );

  return (
    <>
      {view === "allocations" && (
        <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
          <span className="w-full text-xs font-semibold">Allocate from a purchase line (qty is checked against the ordered qty)</span>
          {f("poNo", "PO no")}{f("poLineNo", "PO line", "w-20")}{f("contractNo", "Contract no")}{f("itemCode", "Contract item code")}
          <input className={`${input} w-20`} type="number" min={0} placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          {f("lot", "Lot")}{f("tinaInvoiceNo", "Tina invoice no")}{f("blNo", "B/L")}{f("eta", "ETA")}{f("remarks", "Remarks", "w-40")}
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={form.needsConfirmation} onChange={(e) => setForm({ ...form, needsConfirmation: e.target.checked })} />Needs confirmation
          </label>
          <Button size="sm" disabled={busy === "add-purchase"} onClick={add}>Allocate</Button>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField value={state.search} onCommit={(value) => dispatch(setSearch({ view, value }))} busy={table.refreshing}
          placeholder={view === "lots" ? "Search PO line, item, lot, invoice, B/L" : "Search PO line, contract, item, lot, invoice, B/L"} />
        <FilterChips
          chips={chips}
          onRemove={(chip) => dispatch(setFilter({ view, key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => !(chip.values ?? [chip.value]).includes(v)) }))}
          onClear={() => dispatch(clearFilters({ view }))}
        />
      </div>
      <DataTable
        columns={columns}
        rows={table.data?.rows ?? []}
        rowId={(r) => r.id}
        sort={state.sort}
        onSortChange={(sort) => dispatch(setSort({ view, sort }))}
        filters={state.filters}
        onFilterChange={(key, values) => dispatch(setFilter({ view, key, values }))}
        facetOptions={table.getFacetOptions}
        onFacetOpen={(key) => void table.requestFacet(key)}
        selectedId={state.selectedId}
        onSelect={(id) => dispatch(select({ view, id }))}
        loading={table.loading}
        refreshing={table.refreshing}
        error={table.error}
        onRetry={() => void table.refresh()}
        hasFilters={chips.length > 0 || Boolean(state.search)}
        onClearFilters={() => dispatch(clearFilters({ view }))}
        onPageStep={(d) => {
          const next = state.page + d;
          if (next >= 1 && next <= Math.ceil(total / state.pageSize)) dispatch(setPage({ view, page: next }));
        }}
      />
      <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(page) => dispatch(setPage({ view, page }))} onPageSizeChange={(pageSize) => dispatch(setPageSize({ view, pageSize }))} />
    </>
  );
}
