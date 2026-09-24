"use client";

import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import MultiSelectFilter, { BLANK } from "@/components/table/MultiSelectFilter";
import Pagination from "@/components/table/Pagination";

interface IndentListingTableProps {
  title: string;
  rows: unknown[][];
  ids: string[];
}

interface ColumnDef {
  label: string;
  key: string;
  dataIdx: number;
  numeric: boolean;
}

// Display columns. `dataIdx` maps the display index to the raw row index
// (rows carry 9 fields: item, size, pnRating, mcReceivedPending, total, v1..v4;
// the MC RECEIVED/PENDING field is skipped in the UI). V1..V4 hold the
// BAL BILL AG CONT for each variant of the item, derived on recompute.
const COLUMNS: ColumnDef[] = [
  { label: "ITEM NAME", key: "item", dataIdx: 0, numeric: false },
  { label: "SIZE", key: "size", dataIdx: 1, numeric: false },
  { label: "PN RATING", key: "pnRating", dataIdx: 2, numeric: false },
  { label: "Total Bal bill ag cont", key: "total", dataIdx: 4, numeric: true },
  { label: "V1", key: "v1", dataIdx: 5, numeric: true },
  { label: "V2", key: "v2", dataIdx: 6, numeric: true },
  { label: "V3", key: "v3", dataIdx: 7, numeric: true },
  { label: "V4", key: "v4", dataIdx: 8, numeric: true },
];

const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 280,
  1: 110,
  2: 130,
  3: 150,
  4: 110,
  5: 110,
  6: 110,
  7: 110,
};

function cellText(row: unknown[], dataIdx: number): string {
  return String(row[dataIdx] ?? "").trim();
}

function compareCell(a: string, b: string, numeric: boolean): number {
  if (a === b) return 0;
  if (numeric) {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    const aNaN = Number.isNaN(an);
    const bNaN = Number.isNaN(bn);
    if (aNaN && bNaN) return a.localeCompare(b, undefined, { numeric: true });
    if (aNaN) return 1; // blanks/non-numeric last
    if (bNaN) return -1;
    return an - bn;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

export default function IndentListingTable({
  title,
  rows,
  ids,
}: IndentListingTableProps) {
  const [sortIdx, setSortIdx] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filters, setFilters] = useState<Record<number, string[]>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    DEFAULT_COLUMN_WIDTHS,
  );
  const tableRef = useRef<HTMLTableElement>(null);

  const getColWidth = (idx: number) => columnWidths[idx] ?? DEFAULT_COLUMN_WIDTHS[idx] ?? 120;
  const totalTableWidth =
    COLUMNS.reduce((acc, _, idx) => acc + getColWidth(idx), 0);

  // Mouse drag handler for column resizing. Paints straight to the DOM during
  // the drag and commits the width once on mouseup.
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getColWidth(columnIndex);
    let latestWidth = startWidth;

    const table = tableRef.current;
    const col = table?.querySelectorAll(
      "colgroup > col",
    )[columnIndex] as HTMLElement | undefined;
    const startTotalWidth = table ? parseFloat(table.style.width) || 0 : 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      latestWidth = Math.max(60, startWidth + deltaX);
      if (col) col.style.width = `${latestWidth}px`;
      if (table)
        table.style.width = `${startTotalWidth + (latestWidth - startWidth)}px`;
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (latestWidth !== startWidth) {
        setColumnWidths((prev) => ({ ...prev, [columnIndex]: latestWidth }));
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const columnOptions = useMemo(() => {
    const options: Record<number, string[]> = {};
    COLUMNS.forEach((col, idx) => {
      const values = new Set<string>();
      for (const row of rows) {
        const v = cellText(row, col.dataIdx);
        if (v !== "") values.add(v);
      }
      options[idx] = [...values].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    });
    return options;
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    for (const [colIdxStr, selected] of Object.entries(filters)) {
      const colIdx = Number(colIdxStr);
      const col = COLUMNS[colIdx];
      if (!col || selected.length === 0) continue;
      out = out.filter((row) => {
        const v = cellText(row, col.dataIdx);
        const selectedSet = new Set(selected);
        if (selectedSet.has(BLANK)) return v === "";
        return selectedSet.has(v);
      });
    }
    return out;
  }, [rows, filters]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    if (sortIdx !== null) {
      const col = COLUMNS[sortIdx];
      out.sort((a, b) => {
        const av = cellText(a, col.dataIdx).toLowerCase();
        const bv = cellText(b, col.dataIdx).toLowerCase();
        const cmp = compareCell(av, bv, col.numeric);
        return sortAsc ? cmp : -cmp;
      });
    }
    return out;
  }, [filtered, sortIdx, sortAsc]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const sortedIds = useMemo(() => {
    if (sorted.length === 0) return [];
    const idByRow = new Map<unknown[], string>();
    rows.forEach((r, i) => idByRow.set(r, ids[i]));
    const out: string[] = [];
    for (const r of sorted) out.push(idByRow.get(r) ?? "");
    return out;
  }, [sorted, rows, ids]);

  const handleSort = (idx: number) => {
    if (sortIdx === idx) {
      setSortAsc((prev) => !prev);
    } else {
      setSortIdx(idx);
      setSortAsc(true);
    }
  };

  const sortArrow = (idx: number) =>
    sortIdx === idx ? (
      <span className="text-[#0f62fe] dark:text-blue-400">{sortAsc ? "↑" : "↓"}</span>
    ) : null;

  const hasActiveFilters = Object.values(filters).some((v) => v.length > 0);

  const renderCell = (row: unknown[], col: ColumnDef) => {
    return String(row[col.dataIdx] ?? "") || "—";
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {title} · {filtered.length} of {rows.length} rows
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full min-w-0 border-b border-border">
        <table
          ref={tableRef}
          className="border-collapse text-left border border-border"
          style={{ tableLayout: "fixed", width: totalTableWidth }}
        >
          <colgroup>
            {COLUMNS.map((_, idx) => (
              <col key={idx} style={{ width: getColWidth(idx) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-muted select-none">
              {COLUMNS.map((col, idx) => (
                <th
                  key={col.key}
                  className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0"
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => handleSort(idx)}
                      className="flex items-center gap-1 cursor-pointer hover:text-foreground font-bold uppercase tracking-wider"
                    >
                      <span>{col.label}</span>
                      {sortArrow(idx)}
                    </button>
                  </div>
                  <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                    <MultiSelectFilter
                      label={col.label}
                      allLabel={`${col.label}: All`}
                      options={columnOptions[idx] ?? []}
                      cascadedOptions={columnOptions[idx] ?? []}
                      selected={filters[idx] ?? []}
                      onChange={(v) =>
                        setFilters((prev) => ({ ...prev, [idx]: v }))
                      }
                      includeBlank
                    />
                  </div>
                  <div
                    onMouseDown={(e) => handleMouseDown(idx, e)}
                    className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                    style={{ marginRight: "-3px" }}
                  >
                    <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                    <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-background">
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="py-20 px-4 text-center border-b border-border"
                >
                  <div className="flex flex-col items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
                      <Search className="h-6 w-6 stroke-[1.5]" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">
                      No rows found
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                      Try adjusting the filters to see more rows.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row, rowIdx) => {
                const id = sortedIds[(page - 1) * pageSize + rowIdx];
                return (
                  <tr
                    key={id || rowIdx}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    {COLUMNS.map((col, idx) => (
                      <td
                        key={col.key}
                        className={`py-2.5 px-4 text-xs border-r border-b border-border last:border-r-0 truncate ${
                          col.numeric
                            ? "font-bold text-foreground text-right tabular-nums"
                            : "text-muted-foreground"
                        } ${idx === 0 ? "font-semibold text-foreground" : ""}`}
                      >
                        {renderCell(row, col)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalCount={sorted.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}