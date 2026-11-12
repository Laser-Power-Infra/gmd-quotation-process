"use client";

import type { ReactNode } from "react";
import { formatLakh } from "@gmd/ui/lib/format";
import { cn } from "@gmd/ui/lib/utils";
import type { ChartBar, PurchaseMeta } from "../../poColumns";

// KPI tiles and the three charts. Plain CSS bars in one hue: every chart is a
// single series, so the title names it and no legend is needed.

const count = new Intl.NumberFormat("en-IN");
const panel = "rounded-xl border border-border bg-card";

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={cn(panel, "min-w-0 px-3.5 py-2.5")}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

export function KpiCards({ kpi }: { kpi: PurchaseMeta["kpi"] | undefined }) {
  const k = kpi;
  const money = (n: number | undefined) => (k ? formatLakh(n ?? 0) : "–");
  const n = (v: number | undefined) => (k ? count.format(v ?? 0) : "–");
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Open PO value" value={money(k?.openPoValue)} sub={`Ordered value of ${n(k?.openLines)} open lines`} />
      <Kpi label="In-transit value" value={money(k?.inTransitValue)} sub="Balance qty × rate, still to arrive" />
      <Kpi label="Overdue lines" value={n(k?.overdueLines)} sub={`${money(k?.overdueValue)} past delivery date`} />
      <Kpi label="Due in next 30 days" value={money(k?.due30Value)} sub={`${n(k?.due30Lines)} lines`} />
      <Kpi label="Suppliers with open POs" value={n(k?.suppliers)} sub="Distinct suppliers" />
      <Kpi label="Untagged lines" value={n(k?.untaggedLines)} sub={`${money(k?.untaggedValue)} with no sales contract`} />
    </div>
  );
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <section className={cn(panel, "flex h-52 min-w-0 flex-col p-3")}>
      <h2 className="mb-2 text-xs font-semibold">{title}</h2>
      {empty ? <p className="m-auto text-xs text-muted-foreground">Nothing open under these filters</p> : children}
    </section>
  );
}

const tip = (b: ChartBar) => `${b.label}: ${formatLakh(b.value)} across ${count.format(b.lines)} lines`;

/** Horizontal bars, one row per label; rows become toggles when `onPick` is given. */
export function BarList({
  title,
  bars,
  active,
  onPick,
  hint,
}: {
  title: string;
  bars: ChartBar[];
  active?: (bar: ChartBar) => boolean;
  onPick?: (bar: ChartBar) => void;
  hint?: (bar: ChartBar) => string | null;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <ChartCard title={title} empty={bars.length === 0}>
      <ul className="-mr-1 flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
        {bars.map((b) => {
          const sub = hint?.(b);
          const row = (
            <>
              <span className="min-w-0">
                <span className="block truncate text-xs">{b.label}</span>
                {sub && <span className="line-clamp-2 text-[10px] text-muted-foreground">{sub}</span>}
              </span>
              <span className="h-2 self-center">
                <span className="block h-full min-w-0.5 rounded-r-[4px] bg-primary" style={{ width: `${(b.value / max) * 100}%` }} />
              </span>
              <span className="self-center text-right text-xs tabular-nums">{formatLakh(b.value)}</span>
            </>
          );
          const layout = "grid w-full grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto] gap-2 rounded-md px-1.5 py-0.5 text-left";
          return (
            <li key={b.code ?? b.label} title={tip(b) + (sub ? `. ${sub}` : "")}>
              {onPick ? (
                <button
                  type="button"
                  aria-pressed={active?.(b) ?? false}
                  onClick={() => onPick(b)}
                  className={cn(layout, "outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-primary/10 motion-reduce:transition-none")}
                >
                  {row}
                </button>
              ) : (
                <div className={layout}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

const monthLabel = (label: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  return m ? `${new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString("en-IN", { month: "short" })} ${m[1].slice(2)}` : label;
};

/** Expected receipts per delivery month: "Earlier" (already past) first, undated last. */
export function MonthColumns({ title, bars }: { title: string; bars: ChartBar[] }) {
  const rank = (l: string) => (l === "Earlier" ? "0" : l === "No date" ? "9" : `1${l}`);
  const sorted = [...bars].sort((a, b) => rank(a.label).localeCompare(rank(b.label)));
  const max = Math.max(1, ...sorted.map((b) => b.value));
  return (
    <ChartCard title={title} empty={sorted.length === 0}>
      <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto">
        {sorted.map((b) => (
          <div key={b.label} title={tip(b)} className="flex min-w-12 flex-1 flex-col items-center gap-1">
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-end">
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatLakh(b.value).replace("₹", "")}</span>
              <span className="w-full max-w-8 min-h-0.5 rounded-t-[4px] bg-primary" style={{ height: `${(b.value / max) * 80}%` }} />
            </div>
            <span className="text-[10px] whitespace-nowrap text-muted-foreground">{monthLabel(b.label)}</span>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

const AGEING_BUCKETS = ["Not due", "0-30", "31-90", "91-180", "180+"];

/** Every bucket shown, in order, even when empty. */
export const ageingBars = (bars: ChartBar[]): ChartBar[] =>
  bars.length === 0 ? [] : AGEING_BUCKETS.map((label) => bars.find((b) => b.label === label) ?? { label, value: 0, lines: 0 }).map((b) => ({ ...b, label: b.label === "Not due" ? b.label : `${b.label} days` }));
