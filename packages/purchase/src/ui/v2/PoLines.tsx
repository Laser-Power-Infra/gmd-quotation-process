"use client";

import { useEffect, useState } from "react";
import { formatCell } from "@gmd/ui/components/data-table/format";
import { formatLakh } from "@gmd/ui/lib/format";
import { cn } from "@gmd/ui/lib/utils";
import type { PoLine, PoRow, PurchaseQuery, PurchaseV2Actions } from "../../poColumns";

// Drill-down of one PO: what the supplier is owed (Creditors) and its lines.

const n = (v: number | null) => formatCell(v, "number");
const pct = (part: number | null, whole: number | null) => (part === null || !whole ? "" : `${Math.min(100, Math.round((part / whole) * 100))}%`);

/** Rate against a reference rate: "+12.5%" means this PO pays more. */
function variance(rate: number | null, ref: number | null) {
  if (rate === null || !ref) return null;
  const d = ((rate - ref) / ref) * 100;
  if (Math.abs(d) < 0.05) return { text: "same", higher: false };
  return { text: `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`, higher: d > 0 };
}

function RateCell({ rate, base }: { rate: number | null; base: number | null }) {
  const v = variance(rate, base);
  return (
    <>
      {n(base)}
      {v && <span className={cn("ml-1.5 text-[11px]", v.higher ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground")}>{v.text}</span>}
    </>
  );
}

const linkClass = "rounded-sm text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

interface PoLinesProps {
  po: PoRow;
  query: PurchaseQuery;
  /** Changes when the filters change, so the lines reload with them. */
  filterKey: string;
  loadLines: PurchaseV2Actions["loadLines"];
  onItemClick?: (itemCode: string) => void;
  onContractClick?: (contract: string) => void;
}

export function PoLines({ po, query, filterKey, loadLines, onItemClick, onContractClick }: PoLinesProps) {
  const [lines, setLines] = useState<PoLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLines(po.poNo, query).then((res) => {
      if (cancelled) return;
      if (res.success) setLines(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
    // `query` is covered by filterKey; page/sort changes must not reload the lines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po.poNo, filterKey, loadLines]);

  const p = po.payable;
  const th = "px-2.5 py-1.5 text-left font-medium whitespace-nowrap";
  const td = "border-t border-border px-2.5 py-1.5 whitespace-nowrap";
  const right = "text-right tabular-nums";

  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-semibold">Payment outstanding to {po.supplier || po.supplierCode}</span>
        {p ? (
          <>
            <span>Bills {formatLakh(p.bills)}</span>
            <span>Advances {formatLakh(p.advances)}</span>
            <span className="font-medium">Net payable {formatLakh(p.net)}</span>
            <span>Overdue {formatLakh(p.overdue)}</span>
            <span>180+ days {formatLakh(p.over180)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No open bills or advances in Creditors</span>
        )}
      </p>
      {error ? (
        <p className="text-red-700 dark:text-red-400">Could not load lines: {error}</p>
      ) : !lines ? (
        <p className="text-muted-foreground">Loading lines…</p>
      ) : (
        <table className="border-separate border-spacing-0 overflow-hidden rounded-lg border border-border bg-card">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className={th}>Line</th>
              <th className={th}>Item code</th>
              <th className={th}>Item</th>
              <th className={cn(th, "text-right")}>Ordered</th>
              <th className={cn(th, "text-right")}>Received</th>
              <th className={cn(th, "text-right")}>Balance</th>
              <th className={th}>UOM</th>
              <th className={cn(th, "text-right")}>Received %</th>
              <th className={cn(th, "text-right")}>Rate</th>
              <th className={cn(th, "text-right")}>Last rate</th>
              <th className={cn(th, "text-right")}>Lowest rate</th>
              <th className={cn(th, "text-right")}>Open value</th>
              <th className={th}>Delivery date</th>
              <th className={cn(th, "text-right")}>Days overdue</th>
              <th className={th}>Sales contract</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className={cn(l.status === "Overdue" && "bg-red-500/6 text-red-800 dark:text-red-300")}>
                <td className={td}>{l.lineNo}</td>
                <td className={td}>
                  {l.itemCode && onItemClick ? (
                    <button type="button" className={linkClass} title="Open in Physical Stock (free / allocated)" onClick={() => onItemClick(l.itemCode)}>
                      {l.itemCode}
                    </button>
                  ) : (
                    l.itemCode
                  )}
                </td>
                <td className={cn(td, "max-w-72 truncate")} title={l.itemName ?? undefined}>
                  {l.itemName}
                </td>
                <td className={cn(td, right)}>{n(l.ordered)}</td>
                <td className={cn(td, right)}>{n(l.received)}</td>
                <td className={cn(td, right, "font-medium")}>{n(l.balance)}</td>
                <td className={td}>{l.uom}</td>
                <td className={cn(td, right)}>{pct(l.received ?? 0, l.ordered)}</td>
                <td className={cn(td, right)}>{n(l.rate)}</td>
                <td className={cn(td, right)}>
                  <RateCell rate={l.rate} base={l.lastRate} />
                </td>
                <td className={cn(td, right)}>
                  <RateCell rate={l.rate} base={l.minRate} />
                </td>
                <td className={cn(td, right)}>{n(l.openValue)}</td>
                <td className={td}>{formatCell(l.due, "date")}</td>
                <td className={cn(td, right)}>{n(l.daysOverdue)}</td>
                <td className={td}>
                  {l.contract && onContractClick ? (
                    <button type="button" className={linkClass} title="Open in Contract Review" onClick={() => onContractClick(l.contract)}>
                      {l.contract}
                    </button>
                  ) : (
                    l.contract
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
