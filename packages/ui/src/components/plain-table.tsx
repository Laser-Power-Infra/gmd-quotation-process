import type { ElementType, ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { TableSort } from "./data-table/types";

export const TH = "border-r border-border px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-normal align-bottom";
export const TD = "border-r border-border px-3 py-2";
export const TDN = "border-r border-border px-3 py-2 text-right tabular-nums";

/** Header click cycle: ascending → descending → off. */
export const nextSort = (sort: TableSort | null, key: string): TableSort | null =>
  sort?.key !== key ? { key, dir: "asc" } : sort.dir === "asc" ? { key, dir: "desc" } : null;

/**
 * Sortable header cell. Client tables pass `onSort`; server pages pass `href`, the URL of the
 * next sort, and `linkAs={Link}` (next/link; this package has no next dependency) to sort without
 * a full page reload. `children` render under the label (e.g. a column filter).
 */
export function SortTh({ k, label, sort, onSort, href, linkAs: LinkAs = "a", className = TH, children }: {
  k: string;
  label: ReactNode;
  sort: TableSort | null;
  onSort?: (next: TableSort | null) => void;
  href?: (next: TableSort | null) => string;
  linkAs?: ElementType;
  className?: string;
  children?: ReactNode;
}) {
  const dir = sort?.key === k ? sort.dir : null;
  const next = nextSort(sort, k);
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
  // Buttons do not inherit text-transform, so an uppercase header would lose it.
  const cls = "inline-flex cursor-pointer items-center gap-1 rounded-sm [text-align:inherit] [text-transform:inherit] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const inner = <>{label}<Icon aria-hidden size={12} className={`shrink-0 ${dir ? "" : "opacity-40"}`} /></>;
  return (
    <th className={className} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
      {href ? <LinkAs href={href(next)} className={cls}>{inner}</LinkAs> : <button type="button" onClick={() => onSort?.(next)} className={cls}>{inner}</button>}
      {children}
    </th>
  );
}

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
