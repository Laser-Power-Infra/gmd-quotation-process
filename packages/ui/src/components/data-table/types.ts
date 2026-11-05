import type { ReactNode } from "react";

// Generic, store-agnostic table contracts. Business rules (which column filters,
// sorts, edits) are expressed by the caller through DataColumn.

export type ColumnKind = "text" | "number" | "date" | "boolean";
export type EditMode = "text" | "select";

export interface DataColumn<Row> {
  /** Row property and server-side filter/sort key. */
  key: string;
  label: string;
  kind: ColumnKind;
  /** Facet dropdown in the header. */
  filter?: boolean;
  sortable?: boolean;
  edit?: EditMode;
  /** Per-row gate for `edit` (e.g. only while blank). Default: always. */
  canEdit?: (row: Row) => boolean;
  /** Fixed options for `select` edits; `editOptions` on the table overrides per row. */
  options?: readonly string[];
  /** Pinned to the left while scrolling horizontally. */
  sticky?: boolean;
  align?: "left" | "right";
  /** Minimum width in px. */
  width?: number;
  render?: (row: Row) => ReactNode;
}

export interface TableSort {
  key: string;
  dir: "asc" | "desc";
}

/** ISO yyyy-mm-dd bounds, inclusive; either may be blank. */
export interface DateRange {
  from: string;
  to: string;
}

export interface TableQuery {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  search: string;
  /** Facet selections per column key; BLANK selects empty cells. */
  filters: Record<string, string[]>;
  /** Start/end filters of date columns by key. */
  dateRanges?: Record<string, DateRange>;
  /** Per-column "contains" text, case- and space-insensitive. */
  columnSearch?: Record<string, string>;
  /** Caller-specific predicates the server understands. */
  extra?: Record<string, unknown>;
}

export interface TablePage<Row, Meta = unknown> {
  rows: Row[];
  total: number;
  meta?: Meta;
}

/** Facet value standing for an empty cell. */
export const BLANK = "(Blank)";

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export const cellText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
