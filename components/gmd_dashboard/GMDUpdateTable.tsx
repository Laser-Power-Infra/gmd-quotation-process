"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, Search, RotateCcw, X } from "lucide-react";
import GMDUpdateStatusBadge from "./GMDUpdateStatusBadge";
import {
  STATUS_COLUMNS,
  NUMERIC_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
} from "../../lib/gmd_lib/sheet-columns";
import Pagination from "./Pagination";
import { useAppDispatch } from "@/lib/hooks";
import { updateGMDUpdateField } from "@/lib/gmdUpdateSlice";
import {toast} from "sonner"

interface GMDUpdateTableProps {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  title?: string;
  editable?: boolean;
  editableColumns?: string[];
  hiddenFilters?: string[];
  categoryOptions?: Record<string, string[]>;
}

export default function GMDUpdateTable({
  headers,
  rows,
  ids,
  selectedIndex,
  onSelect,
  title,
  editable,
  editableColumns,
  hiddenFilters,
  categoryOptions,
}: GMDUpdateTableProps) {
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [globalSearch, setGlobalSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const dispatch = useAppDispatch();
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    () => {
      const widths: Record<number, number> = {};
      headers.forEach((h, i) => {
        widths[i] = h === "ITEM NAME (proposed)-AUTO" ? 200 : 180;
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

  const getUniqueColumnValues = (colIdx: number, excludeCol?: string): string[] => {
    let sourceRows = sortedRows;
    for (const [colName, filterVal] of Object.entries(columnFilters)) {
      if (!filterVal || filterVal === "All" || colName === excludeCol) continue;
      const cIdx = headers.indexOf(colName);
      if (cIdx === -1) continue;
      sourceRows = sourceRows.filter((row) => {
        const cellVal = String(row[cIdx] ?? "");
        if (filterVal === "(Blank)") return cellVal === "";
        return cellVal.toLowerCase().includes(filterVal.toLowerCase());
      });
    }
    const vals = new Set<string>();
    for (const row of sourceRows) {
      const v = String(row[colIdx] ?? "");
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  };

  const handleCellUpdate = (
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    const id = ids[rowIndex];
    if (!id) return;
    const field = COL_INDEX_TO_DB_FIELD[colIndex];
    if (!field) return;
    const header = headers[colIndex];

    // Special handling for USD Rate Option changes
    if (field === "usdRateOption") {
      dispatch(updateGMDUpdateField({ id, field, value: value || null }));
      return;
    }

    toast.promise(
      dispatch(updateGMDUpdateField({id,field,value:value ||null})).unwrap(),
      {
        loading: `Updating ${header}...`,
        success: `${header} updated`,
        error: (err)=> err || `Failed to update ${header}`,
      },
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
              <span className="text-xs font-bold uppercase tracking-wider text-">
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
                const uniqueVals = STATUS_COLUMNS.has(header) || categoryOptions?.[header]
                  ? (categoryOptions?.[header] || getUniqueColumnValues(idx, header))
                  : [];
                return (
                  <th
                    key={idx}
                    className={`relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-3 py-2 text-left border-b-2 border-[#e1e6eb] border-r border-[#e1e6eb] last:border-r-0 select-none align-top${
                      idx < 2 ? " sticky z-20" : ""
                    }${
                      editable && (!editableColumns || editableColumns.includes(header)) ? " bg-amber-50/50" : ""
                    }`}
                    style={idx === 1 ? { left: columnWidths[0] } : idx === 0 ? { left: 0 } : undefined}
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
                      {STATUS_COLUMNS.has(header) || categoryOptions?.[header] ? (
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
                    const isCellEditable = editable && (!editableColumns || editableColumns.includes(header));
                    if (isCellEditable) {
                      if (header === "cost") {
                        const rawVal = parseFloat(String(row[15] ?? ""));
                        const rateStr = String(row[16] ?? "").trim();
                        const rate = parseFloat(rateStr);
                        if (rateStr && !isNaN(rawVal) && !isNaN(rate)) {
                          cellContent = (
                            <span className="font-mono-md text-xs font-semibold">$ {(rawVal / rate).toFixed(2)}</span>
                          );
                        } else {
                          cellContent = (
                            <input
                              key={display + "-" + idx + "-" + cellIdx}
                              type="text"
                              defaultValue={display}
                              onBlur={(e) => {
                                if (e.target.value !== display) {
                                  handleCellUpdate(idx, cellIdx, e.target.value);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  (e.target as HTMLInputElement).blur();
                              }}
                              className="w-full text-xs bg-transparent border-none outline-none"
                            />
                          );
                        }
                      } else if (STATUS_COLUMNS.has(header) || categoryOptions?.[header]) {
                        cellContent = (
                          <select
                            key={display + "-" + idx + "-" + cellIdx}
                            defaultValue={display}
                            onChange={(e) =>
                              handleCellUpdate(idx, cellIdx, e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-xs bg-transparent border-none outline-none cursor-pointer"
                          >
                            <option value="">-</option>
                            {(categoryOptions?.[header] || getUniqueColumnValues(cellIdx)).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        );
                      } else {
                        cellContent = (
                          <input
                            key={display + "-" + idx + "-" + cellIdx}
                            type="text"
                            defaultValue={display}
                            onBlur={(e) => {
                              if (e.target.value !== display) {
                                handleCellUpdate(idx, cellIdx, e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                (e.target as HTMLInputElement).blur();
                            }}
                            className="w-full text-xs bg-transparent border-none outline-none"
                          />
                        );
                      }
                    } else if (STATUS_COLUMNS.has(header)) {
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
                        <span className="truncate block" title={display}>
                          {display || "—"}
                        </span>
                      );
                    }

                    return (
                        <td
                        key={cellIdx}
                        className={`px-3 py-2 text-xs border-b border-[#e1e6eb] border-r border-[#e1e6eb] last:border-r-0${
                          cellIdx < 2 ? " sticky z-10 bg-white" : ""
                        }${
                          isCellEditable ? " bg-amber-50" : ""
                        }`}
                        style={cellIdx === 1 ? { left: columnWidths[0] } : cellIdx === 0 ? { left: 0 } : undefined}
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
