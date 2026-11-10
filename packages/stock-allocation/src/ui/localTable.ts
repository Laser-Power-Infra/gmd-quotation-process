import { BLANK, cellText, type DataColumn, type TableSort } from "@gmd/ui/components/data-table/types";

// The whole allocation result is already in the browser, so DataTable's
// sort/facet contract is served in memory instead of by a server query.

const sortKey = (v: unknown, kind: DataColumn<unknown>["kind"]): number | string => {
  if (kind === "number") return typeof v === "number" ? v : Number(v) || 0;
  if (kind === "date") return Date.parse(cellText(v)) || 0;
  return cellText(v).toLowerCase();
};

/** Rows kept by the facet filters, in `sort` order (input order when unsorted). */
export function applyTable<Row>(rows: Row[], columns: DataColumn<Row>[], sort: TableSort | null, filters: Record<string, string[]>): Row[] {
  const get = (r: Row, k: string) => (r as Record<string, unknown>)[k];
  const active = Object.entries(filters).filter(([, v]) => v.length);
  const kept = active.length
    ? rows.filter((r) => active.every(([k, vals]) => vals.includes(cellText(get(r, k)).trim() || BLANK)))
    : rows;
  if (!sort) return kept;
  const kind = columns.find((c) => c.key === sort.key)?.kind ?? "text";
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...kept].sort((a, b) => {
    const x = sortKey(get(a, sort.key), kind);
    const y = sortKey(get(b, sort.key), kind);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** Distinct values of one column for its facet dropdown; empty cells as BLANK. */
export function facetValues<Row>(rows: Row[], key: string): string[] {
  const set = new Set(rows.map((r) => cellText((r as Record<string, unknown>)[key]).trim() || BLANK));
  return [...set].sort((a, b) => a.localeCompare(b));
}
