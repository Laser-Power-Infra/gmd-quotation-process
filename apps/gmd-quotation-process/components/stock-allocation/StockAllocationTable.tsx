"use client";

import { useMemo, useState } from "react";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { formatLakh } from "@/lib/debtorsAgeing";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import { TD, TDN, TH, Tile } from "@/components/execution/ui";
import { addBookingAction, deleteBookingAction, reloadAction, setOfferSentAction, updateBookingAction } from "@/app/stock_allocation/actions";
import type { AllocationResult, OfferLine } from "@/lib/stockAllocation/types";

type View = "offer" | "ledger" | "short";
const VIEWS: [View, string][] = [["offer", "Offer Now"], ["ledger", "Stock Allocation Ledger"], ["short", "Not in Stock"]];
const key = (o: OfferLine) => `${o.line.contractNo}|${o.line.itemCode}`;
const rm = (r: OfferLine["rmCodes"][number]) => `${r.erpCode}${r.location ? ` @${r.location}` : ""} ×${r.qty}${r.spare ? " (spare)" : ""}`;
const input = "rounded border border-border bg-background px-2 py-1 text-xs";

export default function StockAllocationTable({ initial }: { initial: AllocationResult }) {
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
  const offer = useMemo(() => data.offerNow.filter((o) => !needle || squish(`${o.line.contractNo} ${o.line.party} ${o.line.itemCode} ${o.rmCodes.map((r) => r.erpCode).join(" ")}`).includes(needle)), [data, needle]);
  const ledger = useMemo(() => data.ledger.filter((l) => !needle || squish(`${l.erpCode} ${l.location} ${l.description} ${l.allocatedTo.map((a) => `${a.contractNo} ${a.itemCode}`).join(" ")}`).includes(needle)), [data, needle]);
  const short = useMemo(() => data.notInStock.filter((c) => !needle || squish(`${c.contractNo} ${c.party} ${c.lines.map((l) => l.line.itemCode).join(" ")}`).includes(needle)).sort((a, b) => b.shortValue - a.shortValue), [data, needle]);
  const manual = data.allocations.filter((a) => a.source === "manual" && a.ledgerId);

  const exportCsv = () => {
    if (view === "offer")
      downloadCsv("offer_now.csv", toCsv(["Contract", "Party", "Date", "Item code", "Item", "Rate", "Balance qty", "Offerable qty", "Offer value", "RM codes", "Basis", "Flags", "Project", "Offer sent", "Remarks"],
        offer.map((o) => [o.line.contractNo, o.line.party, o.line.dateOfContract, o.line.itemCode, o.line.itemName, o.line.rate, o.line.balanceQty, o.offerableQty, o.offerValue, o.rmCodes.map(rm).join("; "), o.basis, o.flags.join("; "), o.line.project, o.offerSent ? "Y" : "", o.remarks])));
    else if (view === "ledger")
      downloadCsv("stock_allocation_ledger.csv", toCsv(["ERP code", "Location", "Description", "Available qty", "Allocated to", "Allocated qty", "Free balance"],
        ledger.map((l) => [l.erpCode, l.location, l.description, l.availableQty, l.allocatedTo.map((a) => `${a.contractNo} / ${a.itemCode} ×${a.qty} (${a.stage})`).join("; "), l.allocatedQty, l.freeBalance])));
    else
      downloadCsv("not_in_stock.csv", toCsv(["Contract", "Party", "Item code", "Item", "Balance qty", "Offerable qty", "Short qty", "Rate", "Short value"],
        short.flatMap((c) => c.lines.map((l) => [c.contractNo, c.party, l.line.itemCode, l.line.itemName, l.line.balanceQty, l.line.balanceQty - l.shortQty, l.shortQty, l.line.rate, l.shortValue]))));
  };

  const addBooking = async () => {
    const ok = await write("add", () => addBookingAction({ erpCode: form.erpCode, location: form.location || null, contractNo: form.contractNo, itemCode: form.itemCode, qty: Number(form.qty), remarks: form.remarks || null }));
    if (ok) setForm({ ...form, erpCode: "", contractNo: "", itemCode: "", qty: "", remarks: "" });
  };

  const tile = (label: string, v: number, n?: number, danger?: boolean) => (
    <Tile label={label} value={`${formatLakh(v)}${n === undefined ? "" : ` · ${n} lines`}`} hint={`Rs ${formatIndianNumber(v)}`} danger={danger} />
  );
  const head = (cols: string[], right: number[] = []) => (
    <thead className="sticky top-0 z-10 border-b border-border bg-muted/80"><tr>{cols.map((h, i) => <th key={i} className={`${TH} ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tile("Finished offerable", s.finished, s.finishedLines)}
        {tile("Assemble", s.assemble, s.assembleLines)}
        {tile("Actuator to map", s.actuator, s.actuatorLines)}
        {tile("Total offerable", s.finished + s.assemble + s.actuator, s.finishedLines + s.assembleLines + s.actuatorLines)}
        {tile("Not in stock (short)", s.short, undefined, true)}
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded border px-3 py-1 text-xs font-semibold ${view === v ? "border-primary bg-primary/10" : "border-border"}`}>{label}</button>
          ))}
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={exportCsv}>Download Excel (CSV)</button>
          {error && <span className="text-xs text-red-600">{error}</span>}
          <div className="ml-auto w-72"><DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search contract, party, item or ERP code" /></div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {view === "offer" && (
            <table className="w-full border-collapse text-left text-[13px]">
              {head(["Contract", "Party", "Date", "Item code", "Item", "Rate", "Balance qty", "Offerable qty", "Offer value", "RM codes", "Basis", "Flags", "Project", "Offer sent", "Remarks"], [5, 6, 7, 8])}
              <tbody className="divide-y divide-border/60">
                {offer.map((o) => {
                  const k = key(o);
                  const text = remarks[k] ?? o.remarks ?? "";
                  return (
                    <tr key={k} className={o.offerSent ? "bg-muted/50 text-muted-foreground" : ""}>
                      <td className={`${TD} font-medium`}>{o.line.contractNo}</td>
                      <td className={TD}>{o.line.party}</td>
                      <td className={TD}>{o.line.dateOfContract ?? "-"}</td>
                      <td className={TD}>{o.line.itemCode}</td>
                      <td className={TD}>{o.line.itemName}</td>
                      <td className={TDN}>{formatIndianNumber(o.line.rate)}</td>
                      <td className={TDN}>{formatIndianNumber(o.line.balanceQty)}</td>
                      <td className={TDN}>{formatIndianNumber(o.offerableQty)}</td>
                      <td className={TDN}>{formatIndianNumber(o.offerValue)}</td>
                      <td className={TD}>{o.rmCodes.map((r, i) => <div key={i}>{rm(r)}</div>)}</td>
                      <td className={TD}>{o.basis}</td>
                      <td className={TD}>{o.flags.join(", ") || "-"}</td>
                      <td className={TD}>{o.line.project ?? "-"}</td>
                      <td className={TD}>
                        <input type="checkbox" checked={o.offerSent} disabled={busy === k} aria-label="Offer sent"
                          onChange={(e) => write(k, () => setOfferSentAction({ contractNo: o.line.contractNo, itemCode: o.line.itemCode, sent: e.target.checked, basis: o.basis, remarks: text || null, rmCodes: o.rmCodes.map(({ erpCode, location, qty }) => ({ erpCode, location, qty })) }))} />
                      </td>
                      <td className={TD}><input className={`${input} w-40`} value={text} readOnly={o.offerSent} onChange={(e) => setRemarks({ ...remarks, [k]: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {view === "ledger" && (
            <>
              <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
                <span className="w-full text-xs font-semibold">Add booking</span>
                <input className={`${input} w-32`} placeholder="ERP code" value={form.erpCode} onChange={(e) => setForm({ ...form, erpCode: e.target.value })} />
                <select className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
                  <option value="">Any location</option><option>KGP</option><option>BALTIKURI</option>
                </select>
                <input className={`${input} w-32`} placeholder="Contract no" value={form.contractNo} onChange={(e) => setForm({ ...form, contractNo: e.target.value })} />
                <input className={`${input} w-32`} placeholder="Item code" value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} />
                <input className={`${input} w-20`} type="number" min={0} placeholder="Qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                <input className={`${input} w-48`} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                <button type="button" disabled={busy === "add"} className="rounded border border-border px-3 py-1 text-xs font-semibold" onClick={addBooking}>Add</button>
              </div>
              {manual.length > 0 && (
                <div className="border-b border-border p-3">
                  <div className="mb-1 text-xs font-semibold">Manual bookings</div>
                  <table className="border-collapse text-[12px]">
                    {head(["ERP code", "Location", "Contract", "Item code", "Qty", "Stage", ""])}
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
              <table className="w-full border-collapse text-left text-[13px]">
                {head(["ERP code", "Location", "Description", "Available qty", "Allocated to", "Allocated qty", "Free balance"], [3, 5, 6])}
                <tbody className="divide-y divide-border/60">
                  {ledger.map((l) => (
                    <tr key={`${l.erpCode}|${l.location}`}>
                      <td className={`${TD} font-medium`}>{l.erpCode}</td><td className={TD}>{l.location ?? "-"}</td><td className={TD}>{l.description}</td>
                      <td className={TDN}>{formatIndianNumber(l.availableQty)}</td>
                      <td className={TD}>{l.allocatedTo.map((a, i) => <div key={i}>{a.contractNo} / {a.itemCode} ×{a.qty} ({a.stage})</div>)}</td>
                      <td className={TDN}>{formatIndianNumber(l.allocatedQty)}</td>
                      <td className={TDN}>{formatIndianNumber(l.freeBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === "short" && (
            <table className="w-full border-collapse text-left text-[13px]">
              {head(["Contract / Item code", "Party / Item", "Balance qty", "Offerable", "Short qty", "Rate", "Short value"], [2, 3, 4, 5, 6])}
              <tbody className="divide-y divide-border/60">
                {short.flatMap((c) => [
                  <tr key={c.contractNo} className="bg-muted/50 font-semibold">
                    <td className={TD}>{c.contractNo}</td><td className={TD} colSpan={5}>{c.party}</td><td className={TDN} title={`Rs ${formatIndianNumber(c.shortValue)}`}>{formatLakh(c.shortValue)}</td>
                  </tr>,
                  ...c.lines.map((l, i) => (
                    <tr key={`${c.contractNo}-${i}`}>
                      <td className={`${TD} pl-6`}>{l.line.itemCode}</td><td className={TD}>{l.line.itemName}</td>
                      <td className={TDN}>{formatIndianNumber(l.line.balanceQty)}</td><td className={TDN}>{formatIndianNumber(l.line.balanceQty - l.shortQty)}</td>
                      <td className={TDN}>{formatIndianNumber(l.shortQty)}</td><td className={TDN}>{formatIndianNumber(l.line.rate)}</td><td className={TDN}>{formatIndianNumber(l.shortValue)}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
