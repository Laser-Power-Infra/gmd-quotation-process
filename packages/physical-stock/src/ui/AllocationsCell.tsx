"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StockAllocationRow } from "../types";

const COLS = ["Contract", "PO", "Party", "Item", "Qty", "Stage", "Date"];

/** "n orders" that expands into the contract lines holding this row's stock. */
export function AllocationsCell({ list }: { list: StockAllocationRow[] | null }) {
  const [open, setOpen] = useState(false);
  if (!list?.length) return null;
  return (
    <div className="px-3 py-1 text-xs" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {list.length} order{list.length > 1 ? "s" : ""}
      </button>
      {open && (
        <table className="mt-1 border-collapse whitespace-nowrap">
          <thead>
            <tr className="text-muted-foreground">
              {COLS.map((h) => (
                <th key={h} className="px-1 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((a, n) => (
              <tr key={n}>
                <td className="px-1">{a.contractNo}</td>
                <td className="px-1">{a.poNo ?? ""}</td>
                <td className="px-1">{a.party}</td>
                <td className="px-1">{a.itemCode}</td>
                <td className="px-1 text-right tabular-nums">{a.qty}</td>
                <td className="px-1">{a.stage}</td>
                <td className="px-1">{a.allocatedAt?.slice(0, 10) ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
