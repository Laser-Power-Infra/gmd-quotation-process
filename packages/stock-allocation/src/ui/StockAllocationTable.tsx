"use client";

import { useMemo, useState } from "react";
import DebouncedSearchInput from "@gmd/dashboard/components/DebouncedSearchInput";
import { squish } from "@gmd/ui/lib/squish";
import { formatIndianNumber, formatLakh } from "@gmd/ui/lib/format";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { TD, TH, Tile } from "@gmd/ui/components/plain-table";
import { Button } from "@gmd/ui/components/button";
import { Segmented } from "@gmd/ui/components/segmented";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import type { DataColumn, TableSort } from "@gmd/ui/components/data-table/types";
import { applyTable, facetValues } from "./localTable";
import { basisText, rmText as rm } from "../readyToBill";
import type { AllocationResult, OfferLine, StockAllocationActions } from "../types";

type View = "offer" | "ledger" | "short";
const VIEWS = [
  { value: "offer", label: "Offer Now" },
  { value: "ledger", label: "Stock Allocation Ledger" },
  { value: "short", label: "Not in Stock" },
] as const;
const key = (o: OfferLine) => `${o.line.contractNo}|${o.line.itemCode}`;
const input = "rounded border border-border bg-background px-2 py-1 text-xs";

// Cosmetic only: the figures are still in the data sent to the browser.
const RATE_KEYS = ["rate", "shortValue", "contractShort"];
const visible = <Row,>(cols: DataColumn<Row>[], hideRates?: boolean) => (hideRates ? cols.filter((c) => !RATE_KEYS.includes(c.key)) : cols);

type OfferRow = {
  id: string; contractNo: string; party: string; date: string | null; itemCode: string; itemName: string;
  rate: number; balanceQty: number; offerableQty: number; offerValue: number; rmCodes: string; basis: string;
  flags: string; project: string | null; offerSent: boolean; remarks: string; o: OfferLine;
};
type LedgerRow = {
  id: string; erpCode: string; location: string | null; description: string; availableQty: number;
  allocatedTo: string; allocatedQty: number; freeBalance: number;
};
type ShortRow = {
  id: string; contractNo: string; party: string; contractShort: number; itemCode: string; itemName: string;
  balanceQty: number; offerable: number; shortQty: number; rate: number; shortValue: number;
};

const LEDGER_COLS: DataColumn<LedgerRow>[] = [
  { key: "erpCode", label: "ERP code", kind: "text", sticky: true, width: 140, sortable: true },
  { key: "location", label: "Location", kind: "text", width: 110, filter: true, sortable: true },
  { key: "description", label: "Description", kind: "text", width: 320, sortable: true },
  { key: "availableQty", label: "Available qty", kind: "number", align: "right", width: 120, sortable: true },
  { key: "allocatedTo", label: "Allocated to", kind: "text", width: 320 },
  { key: "allocatedQty", label: "Allocated qty", kind: "number", align: "right", width: 120, sortable: true },
  { key: "freeBalance", label: "Free balance", kind: "number", align: "right", width: 120, sortable: true },
];

const SHORT_COLS: DataColumn<ShortRow>[] = [
  { key: "contractNo", label: "Contract", kind: "text", sticky: true, width: 130, filter: true, sortable: true },
  { key: "party", label: "Party", kind: "text", width: 200, filter: true, sortable: true },
  { key: "contractShort", label: "Contract short", kind: "number", align: "right", width: 130, sortable: true, render: (r) => formatLakh(r.contractShort) },
  { key: "itemCode", label: "Item code", kind: "text", width: 130, sortable: true },
  { key: "itemName", label: "Item", kind: "text", width: 260, sortable: true },
  { key: "balanceQty", label: "Balance qty", kind: "number", align: "right", width: 110, sortable: true },
  { key: "offerable", label: "Offerable", kind: "number", align: "right", width: 110, sortable: true },
  { key: "shortQty", label: "Short qty", kind: "number", align: "right", width: 110, sortable: true },
  { key: "rate", label: "Rate", kind: "number", align: "right", width: 110, sortable: true },
  { key: "shortValue", label: "Short value", kind: "number", align: "right", width: 130, sortable: true },
];

/**
 * Sort, facet filters and row selection for one DataTable over in-memory rows.
 * `searching`/`clearSearch`: the toolbar search narrows rows too, so "Clear filters" clears it as well.
 */
function useLocalTable<Row extends { id: string }>(rows: Row[], columns: DataColumn<Row>[], searching: boolean, clearSearch: () => void) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shown = useMemo(() => applyTable(rows, columns, sort, filters), [rows, columns, sort, filters]);
  return {
    shown,
    props: {
      columns, rows: shown, rowId: (r: Row) => r.id, sort, onSortChange: setSort, filters, selectedId, onSelect: setSelectedId,
      hasFilters: searching || Object.values(filters).some((v) => v.length > 0),
      onClearFilters: () => { setFilters({}); clearSearch(); },
      onFilterChange: (k: string, values: string[]) => setFilters((f) => ({ ...f, [k]: values })),
      // Options come from rows passing the other columns' filters, so a pick never empties its own list.
      facetOptions: (k: string) => facetValues(applyTable(rows, columns, null, { ...filters, [k]: [] }), k),
      onFacetOpen: () => undefined,
      loading: false,
      refreshing: false,
    },
  };
}

export default function StockAllocationTable({ initial, actions, hideRates }: { initial: AllocationResult; actions: StockAllocationActions; hideRates?: boolean }) {
  const { addBookingAction, deleteBookingAction, reloadAction, setOfferSentAction, updateBookingAction } = actions;
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View>("offer");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ erpCode: "", location: "", contractNo: "", itemCode: "", qty: "", remarks: "" });
  const [qtyEdit, setQtyEdit] = useState<Record<string, string>>({});
  const s = data.summary;

  // Runs a write, then swaps in fresh engine output so every figure stays consistent.
  const write = async (id: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(id);
    setError(null);
    const res = await fn();
    if (!res.success) setError(res.error ?? "Failed");
    else {
      const fresh = await reloadAction();
      if (fresh.success) setData(fresh.data);
      else setError(fresh.error);
    }
    setBusy(null);
    return res.success;
  };

  const needle = squish(search);
  const offerRows = useMemo<OfferRow[]>(() => data.offerNow
    .filter((o) => !needle || squish(`${o.line.contractNo} ${o.line.party} ${o.line.itemCode} ${o.rmCodes.map((r) => r.erpCode).join(" ")}`).includes(needle))
    .map((o) => ({
      id: key(o), contractNo: o.line.contractNo, party: o.line.party, date: o.line.dateOfContract, itemCode: o.line.itemCode,
      itemName: o.line.itemName, rate: o.line.rate, balanceQty: o.line.balanceQty, offerableQty: o.offerableQty,
      offerValue: o.offerValue, rmCodes: o.rmCodes.map(rm).join("; "), basis: basisText(o.basis), flags: o.flags.join(", "),
      project: o.line.project, offerSent: o.offerSent, remarks: o.remarks ?? "", o,
    })), [data, needle]);
  const ledgerRows = useMemo<LedgerRow[]>(() => data.ledger
    .filter((l) => !needle || squish(`${l.erpCode} ${l.location} ${l.description} ${l.allocatedTo.map((a) => `${a.contractNo} ${a.itemCode}`).join(" ")}`).includes(needle))
    .map((l) => ({
      id: `${l.erpCode}|${l.location}`, erpCode: l.erpCode, location: l.location, description: l.description,
      availableQty: l.availableQty, allocatedQty: l.allocatedQty, freeBalance: l.freeBalance,
      allocatedTo: l.allocatedTo.map((a) => `${a.contractNo} / ${a.itemCode} ×${a.qty} (${a.stage})`).join("; "),
    })), [data, needle]);
  // Unsorted order = biggest short contract first, its lines together.
  const shortRows = useMemo<ShortRow[]>(() => data.notInStock
    .filter((c) => !needle || squish(`${c.contractNo} ${c.party} ${c.lines.map((l) => l.line.itemCode).join(" ")}`).includes(needle))
    .sort((a, b) => b.shortValue - a.shortValue)
    .flatMap((c) => c.lines.map((l, i) => ({
      id: `${c.contractNo}|${i}`, contractNo: c.contractNo, party: c.party, contractShort: c.shortValue,
      itemCode: l.line.itemCode, itemName: l.line.itemName, balanceQty: l.line.balanceQty,
      offerable: l.line.balanceQty - l.shortQty, shortQty: l.shortQty, rate: l.line.rate, shortValue: l.shortValue,
    }))), [data, needle]);
  const manual = data.allocations.filter((a) => a.source === "manual" && a.ledgerId);

  const offerCols = useMemo(() => visible<OfferRow>([
    { key: "contractNo", label: "Contract", kind: "text", sticky: true, width: 130, filter: true, sortable: true },
    { key: "party", label: "Party", kind: "text", width: 200, filter: true, sortable: true },
    { key: "date", label: "Date", kind: "date", width: 110, sortable: true },
    { key: "itemCode", label: "Item code", kind: "text", width: 130, sortable: true },
    { key: "itemName", label: "Item", kind: "text", width: 260, sortable: true },
    { key: "rate", label: "Rate", kind: "number", align: "right", width: 110, sortable: true },
    { key: "balanceQty", label: "Balance qty", kind: "number", align: "right", width: 110, sortable: true },
    { key: "offerableQty", label: "Offerable qty", kind: "number", align: "right", width: 120, sortable: true },
    { key: "offerValue", label: "Offer value", kind: "number", align: "right", width: 130, sortable: true },
    { key: "rmCodes", label: "RM codes", kind: "text", width: 240 },
    { key: "basis", label: "Basis", kind: "text", width: 130, filter: true, sortable: true },
    { key: "flags", label: "Flags", kind: "text", width: 160, filter: true },
    { key: "project", label: "Project", kind: "text", width: 140, filter: true, sortable: true },
    {
      key: "offerSent", label: "Offer sent", kind: "boolean", width: 100,
      render: (r) => (
        <input type="checkbox" checked={r.offerSent} disabled={busy === r.id} aria-label={`Offer sent for ${r.contractNo} ${r.itemCode}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => write(r.id, () => setOfferSentAction({ contractNo: r.contractNo, itemCode: r.itemCode, sent: e.target.checked, basis: r.o.basis, remarks: (remarks[r.id] ?? r.remarks) || null, rmCodes: r.o.rmCodes.map(({ erpCode, location, qty }) => ({ erpCode, location, qty })) }))} />
      ),
    },
    {
      key: "remarks", label: "Remarks", kind: "text", width: 200,
      render: (r) => (
        <input className={`${input} w-full`} value={remarks[r.id] ?? r.remarks} readOnly={r.offerSent} aria-label={`Remarks for ${r.contractNo} ${r.itemCode}`}
          onClick={(e) => e.stopPropagation()} onChange={(e) => setRemarks({ ...remarks, [r.id]: e.target.value })} />
      ),
    },
  ], hideRates),
  // `write` only closes over setters and the actions prop, so it is safe to leave out.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [hideRates, remarks, busy]);
  const ledgerCols = useMemo(() => visible(LEDGER_COLS, hideRates), [hideRates]);
  const shortCols = useMemo(() => visible(SHORT_COLS, hideRates), [hideRates]);

  const clearSearch = () => setSearch("");
  const offerTable = useLocalTable(offerRows, offerCols, !!needle, clearSearch);
  const ledgerTable = useLocalTable(ledgerRows, ledgerCols, !!needle, clearSearch);
  const shortTable = useLocalTable(shortRows, shortCols, !!needle, clearSearch);

  // Downloads exactly what the table shows: same filters, order and visible columns.
  const exportCsv = () => {
    const csv = <Row,>(name: string, cols: DataColumn<Row>[], rows: Row[]) =>
      downloadCsv(name, toCsv(cols.map((c) => c.label), rows.map((r) => cols.map((c) => {
        const v = (r as Record<string, unknown>)[c.key];
        return typeof v === "boolean" ? (v ? "Y" : "") : (v as string | number | null);
      }))));
    if (view === "offer") csv("offer_now.csv", offerCols, offerTable.shown.map((r) => ({ ...r, remarks: remarks[r.id] ?? r.remarks })));
    else if (view === "ledger") csv("stock_allocation_ledger.csv", ledgerCols, ledgerTable.shown);
    else csv("not_in_stock.csv", shortCols, shortTable.shown);
  };

  const addBooking = async () => {
    const ok = await write("add", () => addBookingAction({ erpCode: form.erpCode, location: form.location || null, contractNo: form.contractNo, itemCode: form.itemCode, qty: Number(form.qty), remarks: form.remarks || null }));
    if (ok) setForm({ ...form, erpCode: "", contractNo: "", itemCode: "", qty: "", remarks: "" });
  };

  const tile = (label: string, v: number, n?: number, danger?: boolean) => (
    <Tile label={label} value={`${formatLakh(v)}${n === undefined ? "" : ` · ${n} lines`}`} hint={`Rs ${formatIndianNumber(v)}`} danger={danger} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-5">
        {tile("Finished offerable", s.finished, s.finishedLines)}
        {tile("Assemble", s.assemble, s.assembleLines)}
        {tile(basisText("Actuator to map"), s.actuator, s.actuatorLines)}
        {tile("Total offerable", s.finished + s.assemble + s.actuator, s.finishedLines + s.assembleLines + s.actuatorLines)}
        {tile("Not in stock (short)", s.short, undefined, true)}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Segmented options={VIEWS} value={view} onChange={setView} label="Stock allocation view" />
        <Button variant="outline" size="sm" onClick={exportCsv}>Download Excel (CSV)</Button>
        {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
        <div className="ml-auto w-72"><DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search contract, party, item or ERP code" /></div>
      </div>

      {view === "offer" && (
        <DataTable {...offerTable.props} rowClassName={(r) => (r.offerSent ? "bg-muted/50 text-muted-foreground" : undefined)} />
      )}

      {view === "ledger" && (
        <>
          <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
            <span className="w-full text-xs font-semibold">Add booking</span>
            <input className={`${input} w-32`} placeholder="ERP code" value={form.erpCode} onChange={(e) => setForm({ ...form, erpCode: e.target.value })} />
            <select className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="">Any location</option><option>KGP</option><option>BALTIKURI</option>
            </select>
            <input className={`${input} w-32`} placeholder="Contract no" value={form.contractNo} onChange={(e) => setForm({ ...form, contractNo: e.target.value })} />
            <input className={`${input} w-32`} placeholder="Item code" value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} />
            <input className={`${input} w-20`} type="number" min={0} placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            <input className={`${input} w-48`} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            <Button size="sm" disabled={busy === "add"} onClick={addBooking}>Add</Button>
          </div>
          {manual.length > 0 && (
            <div className="max-h-48 shrink-0 overflow-auto rounded-xl border border-border bg-card p-3">
              <div className="mb-1 text-xs font-semibold">Manual bookings</div>
              <table className="border-collapse text-[12px]">
                <thead className="border-b border-border bg-muted/80"><tr>{["ERP code", "Location", "Contract", "Item code", "Qty", "Stage", ""].map((h, i) => <th key={i} className={TH}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border/60">
                  {manual.map((a) => {
                    const id = a.ledgerId!;
                    return (
                      <tr key={id}>
                        <td className={TD}>{a.erpCode}</td><td className={TD}>{a.location ?? "Any"}</td><td className={TD}>{a.contractNo}</td><td className={TD}>{a.itemCode}</td>
                        <td className={TD}>
                          <input className={`${input} w-20`} type="number" min={0} value={qtyEdit[id] ?? a.qty} onChange={(e) => setQtyEdit({ ...qtyEdit, [id]: e.target.value })} />
                          {qtyEdit[id] !== undefined && (
                            <button type="button" disabled={busy === id} className="ml-1 text-xs text-primary underline"
                              onClick={async () => { if (await write(id, () => updateBookingAction(id, { qty: Number(qtyEdit[id]) }))) setQtyEdit(({ [id]: _, ...r }) => r); }}>Save</button>
                          )}
                        </td>
                        <td className={TD}>{a.stage}</td>
                        <td className={TD}><button type="button" disabled={busy === id} className="text-xs text-red-600 underline" onClick={() => confirm(`Delete booking ${a.erpCode} for ${a.contractNo}?`) && write(id, () => deleteBookingAction(id))}>Delete</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <DataTable {...ledgerTable.props} />
        </>
      )}

      {view === "short" && <DataTable {...shortTable.props} />}
    </div>
  );
}
