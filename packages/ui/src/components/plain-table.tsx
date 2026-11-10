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
