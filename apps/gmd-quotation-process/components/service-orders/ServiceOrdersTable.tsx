"use client";

import { useMemo, useState } from "react";
import { Wrench } from "lucide-react";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { sortRows } from "@gmd/dashboard/lib/tableSort";
import { SortTh } from "@gmd/ui/components/plain-table";
import type { TableSort } from "@gmd/ui/components/data-table/types";
import { formatLakh } from "@/lib/debtorsAgeing";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import type { ServiceOrderRow } from "@/lib/serviceOrders";

const TH = "sticky top-0 z-20 border-b border-r border-border bg-muted px-3 py-2.5 text-[13px] font-semibold text-foreground whitespace-normal align-bottom";
const TD = "border-r border-border px-3 py-2";
const NUM = `${TD} text-right tabular-nums`;

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
const qty = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${danger ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

const COLS = [
  ["orderNo", "Order no"], ["orderDate", "Order date"], ["daysPending", "Days pending"], ["supplier", "Supplier"],
  ["serviceCode", "Service code"], ["serviceName", "Service"], ["ordered", "Ordered"], ["received", "Received"],
  ["pending", "Pending"], ["um", "Unit"], ["rate", "Rate"], ["pendingValue", "Pending value"], ["dueDate", "Due date"],
  ["grnCount", "Receipts (GRN)"], ["lastGrnNo", "Last GRN"], ["lastGrnDate", "Last GRN date"], ["lastBillNo", "Supplier bill no"],
] as const;
const HEADERS = COLS.map(([, h]) => h);

// ISO dates sort correctly as text.
const sortValue = (r: ServiceOrderRow, k: string) =>
  k === "orderNo" ? `${r.orderNo}/${r.lineNo}` : k === "supplier" ? r.supplier ?? r.supplierCode : r[k as keyof ServiceOrderRow];

interface Props {
  rows: ServiceOrderRow[];
  syncedAt: string | null;
  serviceCodes: number;
}

export default function ServiceOrdersTable({ rows, syncedAt, serviceCodes }: Props) {
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<TableSort | null>(null);

  const open = useMemo(() => rows.filter((r) => r.open), [rows]);
  const shown = useMemo(() => {
    const needle = squish(search);
    const kept = rows.filter(
      (r) =>
        (showClosed || r.open) &&
        (!overdueOnly || r.overdue) &&
        (!needle || squish(`${r.orderNo} ${r.supplier} ${r.supplierCode} ${r.serviceCode} ${r.serviceName}`).includes(needle)),
    );
    return sortRows(kept, sort, sortValue);
  }, [rows, search, showClosed, overdueOnly, sort]);

  const exportCsv = () =>
    downloadCsv(
      "service_work_orders.csv",
      toCsv(
        HEADERS,
        shown.map((r) => [
          `${r.orderNo}/${r.lineNo}`, formatDate(r.orderDate), r.daysPending, r.supplier, r.serviceCode, r.serviceName,
          r.ordered, r.received, r.pending, r.um, r.rate, r.pendingValue, formatDate(r.dueDate), r.grnCount,
          r.lastGrnNo, formatDate(r.lastGrnDate), r.lastBillNo,
        ]),
      ),
    );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center">
        <Wrench className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium text-muted-foreground">
          {serviceCodes === 0 ? "No service codes synced yet." : "No service or work orders found for the synced service codes."}
        </p>
      </div>
    );
  }

  const pendingValue = open.reduce((t, r) => t + (r.pendingValue ?? 0), 0);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Open orders" value={String(open.length)} />
        <Tile label="Value still to be received" value={formatLakh(pendingValue)} />
        <Tile label="Past due date" value={String(open.filter((r) => r.overdue).length)} danger />
        <Tile label="Pending over 30 days" value={String(open.filter((r) => (r.daysPending ?? 0) > 30).length)} danger />
        <Tile label="No receipt yet" value={String(open.filter((r) => r.grnCount === 0).length)} />
      </div>
      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Service / Work Orders</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{shown.length} lines</span>
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show fully received
          </label>
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Past due only
          </label>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={exportCsv}>Download CSV</button>
          {syncedAt && <span className="text-xs text-muted-foreground">Service list synced {new Date(syncedAt).toLocaleString("en-IN")}</span>}
          <div className="w-full sm:ml-auto sm:w-72">
            <DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search order, supplier or service" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>{COLS.map(([k, h]) => <SortTh key={k} k={k} label={h} sort={sort} onSort={setSort} className={TH} />)}</tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((r, i) => (
                <tr key={r.id} className={r.overdue ? "bg-red-50 dark:bg-red-950/30" : i % 2 ? "bg-muted" : "bg-card"}>
                  <td className={`${TD} whitespace-nowrap font-medium`}>{r.orderNo}/{r.lineNo}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDate(r.orderDate)}</td>
                  <td className={`${NUM} ${(r.daysPending ?? 0) > 30 ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{r.daysPending ?? "-"}</td>
                  <td className={TD}>{r.supplier ?? r.supplierCode ?? "-"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{r.serviceCode}</td>
                  <td className={`${TD} min-w-[220px]`}>{r.serviceName ?? "-"}</td>
                  <td className={NUM}>{qty(r.ordered)}</td>
                  <td className={NUM}>{qty(r.received)}</td>
                  <td className={`${NUM} font-semibold`}>{qty(r.pending)}</td>
                  <td className={TD}>{r.um ?? "-"}</td>
                  <td className={NUM}>{qty(r.rate)}</td>
                  <td className={NUM}>{r.pendingValue === null ? "-" : formatLakh(r.pendingValue)}</td>
                  <td className={`${TD} whitespace-nowrap ${r.overdue ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{formatDate(r.dueDate)}</td>
                  <td className={NUM}>{r.grnCount || "-"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{r.lastGrnNo ?? "-"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDate(r.lastGrnDate)}</td>
                  <td className={TD}>{r.lastBillNo ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
