"use client";

import { Fragment, memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../button";
import { Skeleton } from "../skeleton";
import { cn } from "../../lib/utils";
import { ColumnHeader } from "./ColumnHeader";
import { EditableCell } from "./EditableCell";
import { LoadingBar } from "./LoadingBar";
import { ResizeHandle } from "./ResizeHandle";
import { formatCell } from "./format";
import { cellText, type DataColumn, type DateRange, type TableSort } from "./types";

export interface DataTableProps<Row> {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  filters: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  dateRanges?: Record<string, DateRange>;
  onDateRangeChange?: (key: string, range: DateRange | undefined) => void;
  columnSearch?: Record<string, string>;
  onColumnSearchChange?: (key: string, value: string) => void;
  facetOptions: (key: string) => string[] | null;
  onFacetOpen: (key: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Resolve false to reject the edit. */
  onEdit?: (row: Row, column: DataColumn<Row>, value: string) => Promise<boolean>;
  /** Per-row options for `select` edits (cascading lists, per-row choices). */
  editOptions?: (row: Row, column: DataColumn<Row>) => Promise<readonly string[]>;
  rowClassName?: (row: Row) => string | undefined;
  /** Detail shown in a full-width row under the selected row (drill-down). */
  renderDetail?: (row: Row) => ReactNode;
  /** First load: skeleton rows. */
  loading: boolean;
  /** Later loads: sweep bar, rows stay. */
  refreshing: boolean;
  error?: string | null;
  onRetry?: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  /** PageUp / PageDown on the table. */
  onPageStep?: (delta: 1 | -1) => void;
}

const DEFAULT_WIDTH = 140;

/** Paged table shell: sticky header, pinned left columns, inline editing, keyboard row selection. */
export function DataTable<Row>({
  columns,
  rows,
  rowId,
  sort,
  onSortChange,
  filters,
  onFilterChange,
  dateRanges = {},
  onDateRangeChange,
  columnSearch = {},
  onColumnSearchChange,
  facetOptions,
  onFacetOpen,
  selectedId,
  onSelect,
  onEdit,
  editOptions,
  rowClassName,
  renderDetail,
  loading,
  refreshing,
  error,
  onRetry,
  hasFilters,
  onClearFilters,
  onPageStep,
}: DataTableProps<Row>) {
  // Column widths the user dragged; 0 / absent = the column's default. Table chrome, not caller state.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const onColumnResize = (key: string, width: number) =>
    setWidths((prev) => {
      const next = { ...prev };
      if (width > 0) next[key] = width;
      else delete next[key];
      return next;
    });
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const widthOf = (c: DataColumn<Row>) => widths[c.key] || c.width || DEFAULT_WIDTH;
  const totalWidth = columns.reduce((sum, c) => sum + widthOf(c), 0);

  // Pinned columns stack from the left edge; each knows the width of those before it.
  const pins = useMemo<Pins>(() => {
    let offset = 0;
    const lefts = columns.map((c) => {
      if (!c.sticky) return null;
      const left = offset;
      offset += widths[c.key] || c.width || DEFAULT_WIDTH;
      return left;
    });
    return { lefts, last: lefts.reduce<number>((acc, l, i) => (l === null ? acc : i), -1) };
  }, [columns, widths]);

  // During a drag only the DOM moves (th width + table width); React gets the final width.
  // The table width is computed, never measured: measured widths are fractional under browser zoom, and the
  // error added up over a drag, so the surplus was spread across every other column.
  const resize = (c: DataColumn<Row>, width: number, final: boolean) => {
    if (final) return onColumnResize(c.key, width);
    const th = tableRef.current?.querySelector<HTMLElement>(`th[data-key="${CSS.escape(c.key)}"]`);
    if (!th || !tableRef.current) return;
    th.style.width = `${width}px`;
    tableRef.current.style.width = `${totalWidth - widthOf(c) + width}px`;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).tagName === "INPUT") return;
    const index = rows.findIndex((r) => rowId(r) === selectedId);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else if (e.key === "PageDown" && onPageStep) return (e.preventDefault(), onPageStep(1));
    else if (e.key === "PageUp" && onPageStep) return (e.preventDefault(), onPageStep(-1));
    else if (e.key === "Escape") return onSelect(null);
    if (next === null || !rows[next]) return;
    e.preventDefault();
    const id = rowId(rows[next]);
    onSelect(id);
    scrollRef.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <LoadingBar active={refreshing} />
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-busy={loading || refreshing}
        className="min-h-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <table ref={tableRef} className="table-fixed border-separate border-spacing-0 text-[13px] leading-tight" style={{ width: totalWidth }}>
          <thead className="sticky top-0 z-20">
            <tr>
              {columns.map((c, i) => {
                const s = stickyCell(pins, i, true);
                return (
                  <th
                    key={c.key}
                    data-key={c.key}
                    scope="col"
                    className={cn(
                      "group/th relative h-10 border-r border-b border-primary-foreground/20 bg-primary p-0 text-left text-xs font-semibold text-primary-foreground whitespace-nowrap last:border-r-0",
                      s?.className,
                    )}
                    style={{ width: widthOf(c), ...s?.style }}
                  >
                    <ColumnHeader
                      column={c}
                      sort={sort}
                      onSortChange={onSortChange}
                      selected={filters[c.key] ?? []}
                      facetOptions={facetOptions(c.key)}
                      onFacetOpen={() => onFacetOpen(c.key)}
                      onFilterChange={(values) => onFilterChange(c.key, values)}
                      dateRange={dateRanges[c.key]}
                      onDateRangeChange={(range) => onDateRangeChange?.(c.key, range)}
                      search={columnSearch[c.key]}
                      onSearchChange={onColumnSearchChange && ((value) => onColumnSearchChange(c.key, value))}
                    />
                    <ResizeHandle label={c.label} onResize={(w, final) => resize(c, w, final)} onReset={() => onColumnResize(c.key, 0)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 10 }, (_, r) => (
                  <tr key={r}>
                    {columns.map((c, i) => (
                      <td key={c.key} className={cn("h-9 border-r border-b border-border px-3 last:border-r-0", stickyCell(pins, i, false)?.className)} style={stickyCell(pins, i, false)?.style}>
                        <Skeleton className="h-3 w-3/4" style={{ width: `${45 + ((r * 7 + i * 13) % 45)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = rowId(row);
                  return (
                    <Fragment key={id}>
                      <DataRow
                        id={id}
                        row={row}
                        selected={id === selectedId}
                        columns={columns}
                        pins={pins}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        editOptions={editOptions}
                        className={rowClassName?.(row)}
                      />
                      {renderDetail && id === selectedId && (
                        <tr>
                          <td colSpan={columns.length} className="border-b border-border bg-muted/30 p-0">
                            {/* Pinned left so the detail stays in view while a wide table scrolls. */}
                            <div className="sticky left-0 w-fit max-w-full p-3">{renderDetail(row)}</div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="sticky left-0 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            {error ? (
              <>
                <p className="text-sm font-medium">Could not load rows</p>
                <p className="max-w-md text-xs text-muted-foreground">{error}</p>
                {onRetry && (
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium">{hasFilters ? "No rows match these filters" : "No rows yet"}</p>
                {hasFilters && (
                  <Button variant="outline" size="sm" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Pins {
  lefts: (number | null)[];
  last: number;
}

const stickyCell = (pins: Pins, i: number, header: boolean) =>
  pins.lefts[i] === null
    ? undefined
    : {
        className: cn(
          "sticky z-10",
          header
            ? "z-30"
            : "bg-[color-mix(in_oklch,var(--secondary)_55%,var(--card))] group-hover/row:bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))] group-data-[selected=true]/row:bg-[color-mix(in_oklch,var(--primary)_16%,var(--card))]",
          i === pins.last && "shadow-[1px_0_0_0_var(--color-border)]",
        ),
        style: { left: pins.lefts[i]! },
      };

interface DataRowProps<Row> {
  id: string;
  row: Row;
  selected: boolean;
  columns: DataColumn<Row>[];
  pins: Pins;
  onSelect: (id: string | null) => void;
  onEdit?: DataTableProps<Row>["onEdit"];
  editOptions?: DataTableProps<Row>["editOptions"];
  className?: string;
}

/** One row; memoized so selecting a row or opening a header filter re-renders one row, not the page. */
const DataRow = memo(function DataRow<Row>({ id, row, selected, columns, pins, onSelect, onEdit, editOptions, className }: DataRowProps<Row>) {
  return (
    <tr
      data-row-id={id}
      data-selected={selected}
      onClick={() => onSelect(selected ? null : id)}
      className={cn(
        "group/row transition-colors duration-100 hover:bg-primary/6 data-[selected=true]:bg-primary/14 motion-reduce:transition-none",
        className,
      )}
    >
      {columns.map((c, i) => {
        const raw = (row as Record<string, unknown>)[c.key];
        const display = c.render ? c.render(row) : formatCell(raw, c.kind);
        const editable = Boolean(c.edit && onEdit && (c.canEdit?.(row) ?? true));
        const s = stickyCell(pins, i, false);
        return (
          <td
            key={c.key}
            className={cn(
              "h-9 border-r border-b border-border p-0 align-middle whitespace-nowrap last:border-r-0",
              c.align === "right" && "text-right",
              s?.className,
            )}
            style={s?.style}
            onClick={editable ? (e) => e.stopPropagation() : undefined}
          >
            {editable ? (
              <EditableCell
                value={cellText(raw)}
                display={typeof display === "string" ? display : cellText(raw)}
                mode={c.edit!}
                options={c.options}
                loadOptions={editOptions && c.edit === "select" ? () => editOptions(row, c) : undefined}
                onSave={(v) => onEdit!(row, c, v)}
                align={c.align}
                fillable={Boolean(c.canEdit) && !cellText(raw)}
              />
            ) : (
              <div className={cn("truncate px-3", c.align === "right" && "tabular-nums")} title={typeof display === "string" ? display : undefined}>
                {display}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}) as <Row>(props: DataRowProps<Row>) => React.JSX.Element;
