"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { ChevronUp, ChevronDown, Search, RotateCcw, X, Download } from "lucide-react";
import GMDUpdateStatusBadge from "./GMDUpdateStatusBadge";
import {
  STATUS_COLUMNS,
  NUMERIC_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
} from "../../lib/gmd_lib/sheet-columns";
import { useDebounce } from "@/lib/hooks/useDebounce";
import Pagination from "./Pagination";
import { useAppDispatch } from "@/lib/hooks";
import { updateGMDUpdateField } from "@/lib/gmdUpdateSlice";
import { toast } from "sonner";

import * as XLSX from "xlsx";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDate(str: string): Date | null {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  const m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) return new Date(`${m[2]} ${m[1]}, ${m[3]}`);
  return null;
}

function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="w-full text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 text-left outline-none cursor-pointer truncate"
      >
        {selected.length ? `${selected.length} selected` : "All"}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 w-48 bg-white border border-[#e1e6eb] rounded shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center px-1 py-1.5 text-[10px] border-b border-[#e1e6eb]">
            <button
              type="button"
              onClick={() => onChange([...options])}
              className="text-blue-600 font-bold hover:underline cursor-pointer"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-red-600 font-semibold hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <label className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[10px]">
              <input
                type="checkbox"
                checked={selected.includes("(Blank)")}
                onChange={() => {
                  const next = selected.includes("(Blank)")
                    ? selected.filter((v) => v !== "(Blank)")
                    : [...selected, "(Blank)"];
                  onChange(next);
                }}
                className="accent-blue-600"
              />
              <span className="italic text-gray-400">(Blank)</span>
            </label>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[10px]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => {
                    const next = selected.includes(opt)
                      ? selected.filter((v) => v !== opt)
                      : [...selected, opt];
                    onChange(next);
                  }}
                  className="accent-blue-600"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DebouncedSearchInput({
  value,
  onCommit,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounce(local, 300);
  const isTypingRef = useRef(false);

  useEffect(() => {
    setLocal(value);
    isTypingRef.current = false;
  }, [value]);

  useEffect(() => {
    if (isTypingRef.current && debounced !== value) onCommit(debounced);
  }, [debounced, value, onCommit]);

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={local}
      onChange={(e) => {
        isTypingRef.current = true;
        setLocal(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      className={
        className ||
        "flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none placeholder:text-[#0a2540]/30"
      }
    />
  );
}

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
  uniqueKeyColumns?: string[];
  onCellUpdate?: (id: string, colIndex: number, value: string) => Promise<void>;
  filterState?: {
    columnFilters: Record<string, string>;
    multiFilters: Record<string, string[]>;
    dateFrom: string;
    dateTo: string;
    globalSearch: string;
    currentPage: number;
    pageSize: number;
  };
  filterActions?: {
    onColumnFilter: (header: string, value: string) => void;
    onMultiFilter: (header: string, values: string[]) => void;
    onDateFrom: (val: string) => void;
    onDateTo: (val: string) => void;
    onGlobalSearch: (val: string) => void;
    onResetFilters: () => void;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
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
  uniqueKeyColumns,
  onCellUpdate,
  filterState,
  filterActions,
}: GMDUpdateTableProps) {
  const isControlled = !!filterState;

  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [localCurrentPage, setLocalCurrentPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(25);
  const [localGlobalSearch, setLocalGlobalSearch] = useState("");
  const [localColumnFilters, setLocalColumnFilters] = useState<
    Record<string, string>
  >({});
  const [localMultiFilters, setLocalMultiFilters] = useState<
    Record<string, string[]>
  >({});
  const [localDateFrom, setLocalDateFrom] = useState("");
  const [localDateTo, setLocalDateTo] = useState("");
  const [editingCells, setEditingCells] = useState<Set<string>>(new Set());

  const currentPage = isControlled
    ? filterState!.currentPage
    : localCurrentPage;
  const pageSize = isControlled ? filterState!.pageSize : localPageSize;
  const globalSearch = isControlled
    ? filterState!.globalSearch
    : localGlobalSearch;
  const columnFilters = isControlled
    ? filterState!.columnFilters
    : localColumnFilters;
  const multiFilters = isControlled
    ? filterState!.multiFilters
    : localMultiFilters;
  const dateFrom = isControlled ? filterState!.dateFrom : localDateFrom;
  const dateTo = isControlled ? filterState!.dateTo : localDateTo;
  const setCurrentPage = isControlled
    ? filterActions!.onPageChange
    : setLocalCurrentPage;
  const setPageSize = isControlled
    ? filterActions!.onPageSizeChange
    : setLocalPageSize;

  const dateColIdx = useMemo(() => headers.indexOf("Date"), [headers]);
  const dispatch = useAppDispatch();
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    () => {
      const widths: Record<number, number> = {};
      headers.forEach((h, i) => {
        widths[i] =
          h === "ITEM NAME (proposed)-AUTO"
            ? 200
            : h === "Party Mail Address"
              ? 300
              : h === "ORDER LIST"
                ? 300
                : 180;
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
    if (isControlled) filterActions!.onColumnFilter(header, value);
    else setLocalColumnFilters((prev) => ({ ...prev, [header]: value }));
    setCurrentPage(1);
  };

  const handleMultiFilter = (header: string, values: string[]) => {
    if (isControlled) filterActions!.onMultiFilter(header, values);
    else
      setLocalMultiFilters((prev) => {
        const next = { ...prev };
        if (values.length) next[header] = values;
        else delete next[header];
        return next;
      });
    setCurrentPage(1);
  };
  const handleExportToExcel = () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows = filteredRows.map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          const v = row[i];
          obj[h] = v != null ? String(v) : "";
        });
        return obj;
      });
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(
        workbook,
        `${title?.replace(/\s+/g, "_") || "Export"}_${dateStr}.xlsx`,
      );
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: any) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const handleResetFilters = () => {
    if (isControlled) filterActions!.onResetFilters();
    else {
      setLocalColumnFilters({});
      setLocalMultiFilters({});
      setLocalGlobalSearch("");
      setLocalDateFrom("");
      setLocalDateTo("");
    }
    setCurrentPage(1);
  };

  const hasActiveFilters =
    Object.values(columnFilters).some((v) => v && v !== "All") ||
    Object.values(multiFilters).some((v) => v.length > 0) ||
    globalSearch.trim() !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  const sortedRows = useMemo(() => {
    if (sortColumn === null) return rows;
    const decorated = rows.map((row, i) => {
      const val = row[sortColumn];
      const isNum = typeof val === "number";
      const num = isNum ? val : NaN;
      const key = isNum ? "" : String(val ?? "").toLowerCase();
      return { row, i, num, key };
    });
    const dir = sortDirection === "asc" ? 1 : -1;
    decorated.sort((a, b) => {
      if (!isNaN(a.num) && !isNaN(b.num)) return (a.num - b.num) * dir;
      const aNull = a.key === "" && isNaN(a.num);
      const bNull = b.key === "" && isNaN(b.num);
      if (aNull && bNull) return a.i - b.i;
      if (aNull) return dir;
      if (bNull) return -dir;
      const c = a.key.localeCompare(b.key, undefined, { numeric: true });
      return c * dir;
    });
    return decorated.map((d) => d.row);
  }, [rows, sortColumn, sortDirection]);

  const rowSearchCache = useMemo(() => {
    const cache = new Map<unknown[], string>();
    for (const row of rows) {
      cache.set(
        row,
        headers.map((_, i) => String(row[i] ?? "").toLowerCase()).join(" "),
      );
    }
    return cache;
  }, [rows, headers]);

  const filteredRows = useMemo(() => {
    let result = sortedRows;

    const gs = globalSearch;
    if (gs.trim()) {
      const q = gs.toLowerCase();
      result = result.filter((row) =>
        (rowSearchCache.get(row) ?? "").includes(q),
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

    for (const [colName, selected] of Object.entries(multiFilters)) {
      if (!selected.length) continue;
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) continue;
      result = result.filter((row) => {
        const cellVal = String(row[colIdx] ?? "").trim();
        const matchesBlank = selected.includes("(Blank)") && cellVal === "";
        return matchesBlank || selected.includes(cellVal);
      });
    }

    if (dateColIdx !== -1 && (dateFrom || dateTo)) {
      const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
      const toEnd = dateTo ? new Date(dateTo + "T23:59:59") : null;
      result = result.filter((row) => {
        const dateStr = String(row[dateColIdx] ?? "");
        if (!dateStr) return false;
        const date = parseDate(dateStr);
        if (!date) return true;
        if (fromDate && date < fromDate) return false;
        if (toEnd && date > toEnd) return false;
        return true;
      });
    }

    return result;
  }, [
    sortedRows,
    globalSearch,
    columnFilters,
    multiFilters,
    headers,
    dateFrom,
    dateTo,
    dateColIdx,
    rowSearchCache,
  ]);

  const pbgAmountSum = useMemo(() => {
    const colIdx = headers.indexOf("PBG AMOUNT");
    if (colIdx === -1) return null;
    return filteredRows.reduce((sum, row) => {
      const cleaned = String(row[colIdx] ?? "").replace(/,/g, "");
      const num = parseFloat(cleaned);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredRows, headers]);

  const totalRecords = filteredRows.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);

  const columnUniqueVals = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const h of headers) {
      const idx = headers.indexOf(h);
      result[h] = categoryOptions?.[h] || getUniqueColumnValues(idx);
    }
    return result;
  }, [headers, categoryOptions, rows]);

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

  function getUniqueColumnValues(colIdx: number): string[] {
    const vals = new Set<string>();
    for (const row of rows) {
      const v = String(row[colIdx] ?? "");
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }

  const uniqueKeyIndices = useMemo(
    () =>
      (uniqueKeyColumns ?? [])
        .map((h) => headers.indexOf(h))
        .filter((i) => i !== -1),
    [uniqueKeyColumns, headers],
  );

  const keyToId = useMemo(() => {
    const map = new Map<string, string>();
    if (!uniqueKeyIndices.length) return map;
    rows.forEach((row, i) => {
      const key = uniqueKeyIndices
        .map((c) => String(row[c] ?? ""))
        .join("|");
      if (key) map.set(key, ids[i]);
    });
    return map;
  }, [rows, ids, uniqueKeyIndices]);

  const handleCellUpdate = async (
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    const row = paginatedRows[rowIndex];
    let id: string | undefined;
    if (uniqueKeyIndices.length && row) {
      const key = uniqueKeyIndices
        .map((c) => String(row[c] ?? ""))
        .join("|");
      id = keyToId.get(key);
    }
    if (!id) id = ids[rowIndex];
    if (!id) return;
    const header = headers[colIndex];

    if (onCellUpdate) {
      await onCellUpdate(id, colIndex, value);
      return;
    }

    const field = COL_INDEX_TO_DB_FIELD[colIndex];
    if (!field) return;

    let savedValue = value || null;
    if (field === "usdRateOption") {
      savedValue = (!value || value.trim() === "" || value.trim() === "0") ? null : value.trim();
    }

    toast.promise(
      dispatch(
        updateGMDUpdateField({ id, field, value: savedValue }),
      ).unwrap(),
      {
        loading: `Updating ${header}...`,
        success: `${header} updated`,
        error: (err) => err || `Failed to update ${header}`,
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
            <DebouncedSearchInput
              value={globalSearch}
              onCommit={(val) => {
                if (isControlled) filterActions!.onGlobalSearch(val);
                else setLocalGlobalSearch(val);
                setCurrentPage(1);
              }}
              placeholder="Search all columns..."
              className="w-60 pl-8 pr-7 py-1.5 text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] outline-none focus:border-[#0070f3] placeholder:text-[#0a2540]/30"
            />
            {globalSearch && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isControlled) filterActions!.onGlobalSearch("");
                  else setLocalGlobalSearch("");
                  setCurrentPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
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
          <button
            type="button"
            onClick={handleExportToExcel}
            className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] hover:text-[#0a2540] transition-colors px-2 py-1.5 rounded hover:bg-white/80 border border-[#e1e6eb]"
          >
            <Download size={12} />
            Export Excel
          </button>
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
          <thead className="sticky top-0 z-20">
            <tr className="bg-[#f4f6f8]">
              {headers.map((header, idx) => {
                const isSorted = sortColumn === idx;
                const uniqueVals = columnUniqueVals[header] ?? [];
                return (
                  <th
                    key={idx}
                    className={`relative bg-[#f4f6f8] text-[#0a2540] text-xs font-bold uppercase tracking-wider px-3 py-2 text-left border-b-2 border-[#e1e6eb] border-r  last:border-r-0 select-none align-top${
                      idx < 2 ? " sticky z-20" : ""
                    }${
                      editable &&
                      (!editableColumns || editableColumns.includes(header))
                        ? " bg-amber-50/50"
                        : ""
                    }`}
                    style={
                      idx === 1
                        ? { left: columnWidths[0] }
                        : idx === 0
                          ? { left: 0 }
                          : undefined
                    }
                  >
                    <div
                      className="flex items-center justify-between gap-1.5 cursor-pointer"
                      onClick={() => handleSort(idx)}
                    >
                      <span className="truncate">{header}</span>
                      {isSorted && (
                        <span className="shrink-0 text-[10px] text-[#0a2540]">
                          {sortDirection === "asc" ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Column filter */}
                    {!hiddenFilters?.includes(header) &&
                      (header === "Date" ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={dateFrom}
                              onChange={(e) => {
                                if (isControlled)
                                  filterActions!.onDateFrom(e.target.value);
                                else setLocalDateFrom(e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                            />
                            <input
                              type="date"
                              value={dateTo}
                              onChange={(e) => {
                                if (isControlled)
                                  filterActions!.onDateTo(e.target.value);
                                else setLocalDateTo(e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-1 py-0.5 outline-none"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters["Date"] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter("Date", val)
                              }
                              placeholder="Search Date..."
                            />
                            {(columnFilters["Date"] || dateFrom || dateTo) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter("Date", "");
                                  if (isControlled)
                                    filterActions!.onDateFrom("");
                                  else setLocalDateFrom("");
                                  if (isControlled) filterActions!.onDateTo("");
                                  else setLocalDateTo("");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <MultiSelect
                            options={uniqueVals}
                            selected={multiFilters[header] ?? []}
                            onChange={(vals) => handleMultiFilter(header, vals)}
                          />
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters[header] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter(header, val)
                              }
                              placeholder={`Search ${header}...`}
                            />
                            {columnFilters[header] && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter(header, "");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[#e1e6eb] text-[#0a2540]/50 hover:text-[#0a2540] transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    {header === "PBG AMOUNT" && pbgAmountSum !== null && (
                      <div className="mt-1 text-[11px] font-semibold text-blue-700">
                        Total :  {"  "}
                        {pbgAmountSum.toLocaleString("en-IN", {
                          maximumFractionDigits: 1,
                        })}
                      </div>
                    )}
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(idx, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 group"
                      style={{ marginRight: "-3px" }}
                    >
                      <div className="absolute top-0 -left-1 w-3.5 h-full" />
                      <div className="absolute right-0.5 top-0 w-0.5 h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] transition-colors" />
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
                    const isCellEditable =
                      editable &&
                      (!editableColumns || editableColumns.includes(header));
                    if (isCellEditable) {
                      if (header === "USD cost") {
                        const rawCost = parseFloat(String(row[15] ?? ""));
                        const rateStr = String(row[16] ?? "").trim();
                        const rate = parseFloat(rateStr);
                        const cellKey = `${idx}-${cellIdx}`;
                        if (editingCells.has(cellKey)) {
                          cellContent = (
                            <input
                              key={cellKey}
                              type="text"
                              defaultValue={rateStr || ""}
                              autoFocus
                              onBlur={(e) => {
                                const newVal = e.target.value;
                                if (newVal !== rateStr) {
                                  handleCellUpdate(idx, cellIdx, newVal);
                                }
                                setEditingCells((prev) => {
                                  const next = new Set(prev);
                                  next.delete(cellKey);
                                  return next;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  (e.target as HTMLInputElement).blur();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-xs bg-transparent border-none outline-none font-mono-md"
                            />
                          );
                        } else if (rate && rate !== 0 && !isNaN(rawCost) && !isNaN(rate)) {
                          cellContent = (
                            <div
                              className="flex items-center gap-1 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingCells((prev) => new Set(prev).add(cellKey));
                              }}
                              title="Click to edit rate"
                            >
                              <span className="text-xs text-black-400 font-mono-md">
                                {rateStr}
                              </span>
                              <span className="text-black-300">|</span>
                              <span className="font-mono-md text-xs font-semibold text-green-700">
                                $ {(rawCost / rate).toFixed(2)}
                              </span>
                            </div>
                          );
                        } else {
                          cellContent = (
                            <input
                              key={cellKey}
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
                      } else if (header === "cost") {
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
                      } else if (
                        STATUS_COLUMNS.has(header) ||
                        categoryOptions?.[header]
                      ) {
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
                            {(
                              categoryOptions?.[header] ||
                              columnUniqueVals[header] ||
                              []
                            ).map((v) => (
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
                    } else if (display && isUrl(display)) {
                      cellContent = (
                        <a
                          href={display}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate block underline text-blue-600 hover:text-blue-800"
                          title={display}
                        >
                          {display}
                        </a>
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
                        className={`px-3 py-2 text-xs border-b border-[#e1e6eb] border-r  last:border-r-0${
                          cellIdx < 2 ? " sticky z-10 bg-white" : ""
                        }${isCellEditable ? " bg-amber-50" : ""}`}
                        style={
                          cellIdx === 1
                            ? { left: columnWidths[0] }
                            : cellIdx === 0
                              ? { left: 0 }
                              : undefined
                        }
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
