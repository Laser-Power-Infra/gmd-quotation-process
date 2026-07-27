"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, Search, RotateCcw, X } from "lucide-react";
import GMDUpdateStatusBadge from "./GMDUpdateStatusBadge";
import {
  STATUS_COLUMNS,
  NUMERIC_COLUMNS,
} from "../../lib/gmd_lib/sheet-columns";
import Pagination from "./Pagination";

interface GMDUpdateTableProps {
  headers: string[];
  rows: unknown[][];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  title?: string;
  editable?: boolean;
  onCellEdit?: (rowIndex: number, colIndex: number, value: string) => void;
  hiddenFilters?: string[];
}

export default function GMDUpdateTable({
  headers,
  rows,
  selectedIndex,
  onSelect,
  title,
  editable,
  onCellEdit,
  hiddenFilters,
}: GMDUpdateTableProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [globalSearch, setGlobalSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    () => {
      const widths: Record<number, number> = {};
      headers.forEach((h, i) => {
        widths[i] = h === "ITEM NAME (proposed)-AUTO" ? 200 : 120;
      });
      return widths;
    },
  );
  const resizingRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleSort = (colIndex: number) => {
    if (sortColumn === colIndex) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(colIndex);
      setSortDirection("desc");
    }
    setCurrentPage(1);
  };

  const handleColumnFilter = (header: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [header]: value }));
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setColumnFilters({});
    setGlobalSearch("");
    setCurrentPage(1);
  };

  const hasActiveFilters =
    Object.values(columnFilters).some((v) => v && v !== "All") ||
    globalSearch.trim() !== "";

  const sortedRows = useMemo(() => {
    if (sortColumn === null) return rows;
    return [...rows].sort((a, b) => {
      const valA = a[sortColumn];
      const valB = b[sortColumn];

      if (valA === null || valA === undefined)
        return sortDirection === "asc" ? -1 : 1;
      if (valB === null || valB === undefined)
        return sortDirection === "asc" ? 1 : -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }

      const strA = String(valA);
      const strB = String(valB);
      return sortDirection === "asc"
        ? strA.localeCompare(strB, undefined, { numeric: true })
        : strB.localeCompare(strA, undefined, { numeric: true });
    });
  }, [rows, sortColumn, sortDirection]);

  const filteredRows = useMemo(() => {
    let result = sortedRows;

    if (globalSearch.trim()) {
      const q = globalSearch.toLowerCase();
      result = result.filter((row) =>
        headers.some((_, idx) =>
          String(row[idx] ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    }

    for (const [colName, filterVal] of Object.entries(columnFilters)) {
      if (!filterVal || filterVal === "All") continue;
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) continue;

      result = result.filter((row) => {
        const cellVal = String(row[colIdx] ?? "");
        if (filterVal === "(Blank)") return cellVal === "";
        return cellVal.toLowerCase().includes(filterVal.toLowerCase());
      });
    }

    return result;
  }, [sortedRows, globalSearch, columnFilters, headers]);

  const totalRecords = filteredRows.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, activePage, pageSize]);

  const handleResizeStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = {
        index,
        startX: e.clientX,
        startWidth: columnWidths[index],
      };
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "col-resize";
    },
    [columnWidths],
  );

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    const { index, startX, startWidth } = resizingRef.current;
    const newWidth = Math.max(60, startWidth + (e.clientX - startX));
    setColumnWidths((prev) => ({ ...prev, [index]: newWidth }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
  }, [handleResizeMove]);

  const getUniqueColumnValues = (colIdx: number): string[] => {
    const vals = new Set<string>();
    for (const row of rows) {
      const v = String(row[colIdx] ?? "");
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  };

  if (headers.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-full min-w-0 bg-white border border-[#e1e6eb] rounded-lg shadow-sm">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e1e6eb] bg-[#f8f9fa]">
        <div className="flex items-center gap-2">
            {title && (
              <span className="text-xs font-bold uppercase tracking-wider text-[#0a2540]/70">
                {title}
              </span>
            )}
            <span className="text-xs font-semibold text-[#0a2540]/60">
              Showing {filteredRows.length} of {rows.length} records
            </span>
          </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0a2540]/40"
            />
            <input
              type="text"
              placeholder="Search all columns..."
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-60 pl-8 pr-3 py-1.5 text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] outline-none focus:border-[#0070f3] placeholder:text-[#0a2540]/30"
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-xs font-semibold text-red-800 hover:text-[#0a2540] transition-colors px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
            >
              <RotateCcw size={12} />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Table */}
      <div className="overflow-x-auto overflow-y-auto w-full min-w-0 max-h-[50vh]">
        {" "}
        <table
          className="w-full text-left"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {headers.map((_, i) => (
              <col key={i} style={{ width: `${columnWidths[i]}px` }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#f4f6f8]">
              {headers.map((header, idx) => {
                const isSorted = sortColumn === idx;
                const uniqueVals = STATUS_COLUMNS.has(header)
                  ? getUniqueColumnValues(idx)
                  : [];
                return (
                  <th
                    key={idx}
                    className="relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-3 py-2 text-left border-b-2 border-[#e1e6eb] border-r border-[#e1e6eb] last:border-r-0 select-none align-top"
                  >
                    <div
                      className="flex items-center justify-between gap-1.5 cursor-pointer"
                      onClick={() => handleSort(idx)}
                    >
                      <span className="truncate">{header}</span>
                      {isSorted && (
                        <span className="flex-shrink-0 text-[10px] text-[#0a2540]">
                          {sortDirection === "asc" ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Column filter */}
                    {!hiddenFilters?.includes(header) && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {STATUS_COLUMNS.has(header) ? (
                        <select
                          value={columnFilters[header] ?? "All"}
                          onChange={(e) =>
                            handleColumnFilter(header, e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none cursor-pointer"
                        >
                          <option value="All">All</option>
                          <option value="(Blank)">(Blank)</option>
                          {uniqueVals.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder={`Filter ${header}...`}
                          value={columnFilters[header] ?? ""}
                          onChange={(e) =>
                            handleColumnFilter(header, e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none placeholder:text-[#0a2540]/30"
                        />
                      )}
                      {columnFilters[header] &&
                        columnFilters[header] !== "All" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleColumnFilter(
                                header,
                                STATUS_COLUMNS.has(header) ? "All" : "",
                              );
                            }}
                            className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                            title="Clear filter"
                          >
                            <X size={10} />
                          </button>
                        )}
                    </div>
                    )}
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(idx, e)}
                      className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                      style={{ marginRight: "-3px" }}
                    >
                      <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                      <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] transition-colors" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No matching rows
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => (
                <tr
                  key={idx}
                  className={`transition-colors hover:bg-gray-50 cursor-pointer ${
                    selectedIndex === idx ? "bg-blue-50" : ""
                  }`}
                  onClick={() => onSelect(idx)}
                >
                  {headers.map((header, cellIdx) => {
                    const value = row[cellIdx];
                    const display = value != null ? String(value) : "";

                    let cellContent: React.ReactNode;
                    if (STATUS_COLUMNS.has(header)) {
                      cellContent = (
                        <GMDUpdateStatusBadge value={display || null} />
                      );
                    } else if (NUMERIC_COLUMNS.has(header)) {
                      cellContent = (
                        <span className="font-mono-md text-right text-foreground">
                          {display || "—"}
                        </span>
                      );
                    } else {
                      cellContent = (
                        <span className="truncate block " title={display}>
                          {display || "—"}
                        </span>
                      );
                    }

                    return (
                      <td
                        key={cellIdx}
                        className="px-3 py-2 text-xs border-b border-[#e1e6eb] border-r border-[#e1e6eb] last:border-r-0"
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        total={totalRecords}
        currentPage={activePage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
