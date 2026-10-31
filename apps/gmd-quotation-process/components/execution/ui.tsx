"use client";

import type { Light } from "@/lib/executionPages";

export const TH = "border-r border-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-normal align-bottom";
export const TD = "border-r border-border px-3 py-2";
export const TDN = "border-r border-border px-3 py-2 text-right tabular-nums";

/** Summary box; clickable as a filter when `onClick` is given. */
export function Tile({ label, value, hint, active, danger, onClick }: { label: string; value: string; hint?: string; active?: boolean; danger?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-lg border px-4 py-3 text-left ${active ? "border-primary bg-primary/10" : "border-border bg-card"} ${onClick ? "cursor-pointer hover:border-primary" : "cursor-default"}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${danger ? "text-red-600" : "text-foreground"}`}>{value}</div>
    </button>
  );
}

const LIGHT_CLASS: Record<Light, string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-600" };
const LIGHT_TEXT: Record<Light, string> = { green: "On track", amber: "Due soon", red: "Stuck / overdue" };

export function Dot({ light, days }: { light: Light; days: number | null }) {
  return (
    <span title={`${LIGHT_TEXT[light]}${days === null ? "" : ` (${days} days since contract)`}`} className={`inline-block h-2.5 w-2.5 rounded-full ${LIGHT_CLASS[light]}`} />
  );
}

/** Header cell with the short form explained on hover. */
export function Abbr({ text, hint }: { text: string; hint?: string }) {
  return hint ? <span title={hint} className="cursor-help underline decoration-dotted">{text}</span> : <>{text}</>;
}
