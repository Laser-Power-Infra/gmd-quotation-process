import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Sales Register: one fiscal year of invoice lines (SupplyHistoryItem, from SALE BILL / MASTER) grouped
// by one dimension into month columns, shown as sales, cost, gross profit or GP %. Every per-column rule
// lives here; the server accepts only these keys. Plain TS: imported by the server, the slice and the page.

/** What the rows group by. Each is a filter too, and a filter stays on when the grouping changes. */
export const DIMS = [
  { key: "party", label: "Party" },
  { key: "valveType", label: "Valve type" },
  { key: "size", label: "Size" },
  { key: "pressureClass", label: "Pressure class" },
] as const;
export type DimKey = (typeof DIMS)[number]["key"];
export const isDimKey = (v: unknown): v is DimKey => DIMS.some((d) => d.key === v);
export const dimLabel = (key: string) => DIMS.find((d) => d.key === key)?.label ?? key;

export const VIEWS = [
  { value: "sales", label: "Sales" },
  { value: "cost", label: "Cost" },
  { value: "gp", label: "Gross Profit (₹)" },
  { value: "gpPct", label: "GP %" },
] as const;
export type View = (typeof VIEWS)[number]["value"];
export const isView = (v: unknown): v is View => VIEWS.some((o) => o.value === v);

/** A fiscal year label: "2026-27" runs April 2026 to March 2027. */
export const FY_PATTERN = /^\d{4}-\d{2}$/;

/** The fiscal year `today` falls in. */
export function currentFy(today = new Date()): string {
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** How the sheets write one fiscal year (as fiscalYearVariants): "2026-27", "26-27", "2026-2027", "2627", "26_27". */
export function fyVariants(fy: string): string[] {
  const start = Number(fy.slice(0, 4));
  const [s, e] = [fy.slice(2, 4), fy.slice(5, 7)];
  return [fy, `${s}-${e}`, `${start}-${start + 1}`, `${s}${e}`, `${s}_${e}`];
}

/** The 12 month keys of a fiscal year label like "2026-27", April first. */
export function fiscalMonths(fy: string): string[] {
  const start = parseInt(fy.slice(0, 4), 10);
  return Array.from({ length: 12 }, (_, i) => {
    const m = (3 + i) % 12;
    return `${m < 3 ? start + 1 : start}-${String(m + 1).padStart(2, "0")}`;
  });
}

/** "2026-04" -> "Apr 26". */
export const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * qty, sales value and the (quoted) cost of one invoice line. A blank sales value is as unknown as
 * a blank cost: SALE BILL inserts carry no value until MASTER covers them, and costing such a line
 * against ₹0 of sales would invent a loss. So the cost is null unless qty, value and rate all exist.
 */
export function saleMoney(quantity: string | null, value: string | null, unitCost: number | null, quotedUnitCost: number | null) {
  const qty = num(quantity);
  const priced = Number.isFinite(parseFloat(String(value ?? "").replace(/,/g, "").trim()));
  const times = (unit: number | null) => (priced && qty > 0 && unit !== null ? qty * unit : null);
  return { qty, value: num(value), cost: times(unitCost), quotedCost: times(quotedUnitCost) };
}

/** Running totals of one Sales Register cell: a group × month, a group's Total, or All. */
export type GpCell = {
  lines: number;
  sales: number;
  /** Lines with no cost: their sales count in `sales`, never in GP. */
  missingLines: number;
  missingSales: number;
  /** Sales and cost of the costed lines, and the GP floor Σ sales × min VA% ÷ (100 + min VA%) over them. */
  costedSales: number;
  cost: number;
  minGp: number;
  /** Sales and quoted cost of the lines the Quotation app has a cost for. */
  quotedSales: number;
  quotedCost: number;
};

export const emptyCell = (): GpCell => ({
  lines: 0, sales: 0, missingLines: 0, missingSales: 0, costedSales: 0, cost: 0, minGp: 0, quotedSales: 0, quotedCost: 0,
});

/** One invoice line as the cells add it up. `cost` null = cost missing, never zero; `minVa` 0 when no rule applies. */
export type PricedLine = { value: number; cost: number | null; minVa: number; quotedCost: number | null };

/** Adds one line to a cell (in place). Every total, All included, is built this way, never from percentages. */
export function addLine(c: GpCell, l: PricedLine): GpCell {
  c.lines++;
  c.sales += l.value;
  if (l.cost === null) {
    c.missingLines++;
    c.missingSales += l.value;
  } else {
    c.costedSales += l.value;
    c.cost += l.cost;
    // VA% is a mark-up on cost (rate = cost × (1 + VA/100)), so at the minimum GP is VA/(100+VA) of sales
    c.minGp += (l.value * l.minVa) / (100 + l.minVa);
  }
  if (l.quotedCost !== null) {
    c.quotedSales += l.value;
    c.quotedCost += l.quotedCost;
  }
  return c;
}

/**
 * GP = sales − cost and GP % = GP ÷ sales × 100, over the costed lines only (weighted); null when
 * the cell has no costed line. Red: GP below what those lines make when priced at their minimum VA% (on cost).
 */
export function gpOf(c: GpCell): { gp: number | null; gpPct: number | null; red: boolean; quotedGpPct: number | null } {
  const gp = c.lines > c.missingLines ? c.costedSales - c.cost : null;
  return {
    gp,
    gpPct: gp !== null && c.costedSales !== 0 ? (gp * 100) / c.costedSales : null,
    red: gp !== null && gp < c.minGp,
    quotedGpPct: c.quotedSales !== 0 ? ((c.quotedSales - c.quotedCost) * 100) / c.quotedSales : null,
  };
}

/** The number a cell shows in a view, which is what its column sorts by; null when it has no line, or no costed line. */
export function viewValue(c: GpCell | undefined, view: View): number | null {
  if (!c?.lines) return null;
  if (view === "sales") return c.sales;
  const g = gpOf(c);
  return g.gp === null ? null : view === "cost" ? c.cost : view === "gp" ? g.gp : g.gpPct;
}

/** One group: its cells by month (yyyy-mm) and its year total. Undated lines count in the total only. */
export interface SalesRow {
  id: string;
  key: string;
  byMonth: Record<string, GpCell>;
  total: GpCell;
}

/** SQL totals over every line the filters keep. */
export interface SalesKpi {
  lines: number;
  sales: number;
  invoices: number;
  parties: number;
  /** Lines with no readable invoice date: in the totals, in no month. */
  undated: number;
}

export interface SalesMeta {
  /** The fiscal year shown (the current one unless another was picked). */
  fy: string;
  /** Fiscal years with lines, newest first. */
  years: string[];
  /** Every filtered line added up, by month and in total. */
  all: SalesRow;
  kpi: SalesKpi;
  /** Last completed SALE BILL run. */
  syncedAt: string | null;
}
export type SalesPageData = TablePage<SalesRow, SalesMeta>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth and the cost rules. `extra` carries fy, group and view. */
export interface SalesRegisterActions {
  loadPage: (query: TableQuery) => Promise<Result<SalesPageData>>;
  loadFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
}

/** The pivot's columns: the group (sortable, filterable), one per shown month, and the total. */
export function pivotColumns(group: DimKey, months: readonly string[]): DataColumn<SalesRow>[] {
  return [
    { key: group, label: dimLabel(group), kind: "text", filter: true, sortable: true, sticky: true, width: 260 },
    ...months.map((m): DataColumn<SalesRow> => ({ key: m, label: monthLabel(m), kind: "number", sortable: true, align: "right", width: 110 })),
    { key: "total", label: "Total", kind: "number", sortable: true, align: "right", width: 130 },
  ];
}
