"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  selectContractReviewBomIdAction,
  updateContractReviewFieldAction,
  backfillContractReviewNoUseBatchAction,
  autoAssignContractReviewBomIdFromActuator,
} from "@/app/actions";
import {
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
  CONTRACT_REVIEW_HEADERS,
} from "@/lib/gmd_lib/contract-review-columns";

interface ContractReviewData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
  pnRatingOptions?: string[];
}

type BalBillFilter = "all" | "yes" | "no";

const STATUS_OPTIONS = [
  "Blanks",
  "Closed",
  "Completed",
  "Duplicate",
  "Hold",
  "Shortclosed",
  "To be closed",
] as const;

function isZeroBal(value: unknown): boolean {
  let s = String(value ?? "").trim();
  if (!s) return false;
  s = s.replace(/^["']+|["']+$/g, "").trim();
  const n = parseFloat(s.replace(/,/g, ""));
  return !isNaN(n) && n === 0;
}

function parseNum(value: unknown): number {
  let s = String(value ?? "").trim();
  if (!s) return NaN;
  s = s.replace(/^["']+|["']+$/g, "").replace(/,/g, "");
  return parseFloat(s);
}

const ITEM_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Item");
const SIZE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("SIZE");
const PN_IDX = CONTRACT_REVIEW_HEADERS.indexOf("PN RATING");
const RATE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("RATE");
const MC_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("MC QTY");
const BOM_ID_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BOM ID");
const NO_USE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("RM AVAIL");
const ACTUATOR_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Actuator");
const ORDER_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ORDER QTY");
const DI_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("DI QTY");
const BILLED_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BILLED QTY");
const BAL_BILL_AG_CONT_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BAL BILL AG CONT");

interface TileOption {
  value: string;
  count: number;
}

function groupCount(
  rows: unknown[][],
  colIdx: number,
  filter: (row: unknown[]) => boolean,
): TileOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!filter(row)) continue;
    const v = String(row[colIdx] ?? "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) =>
      a.value.localeCompare(b.value, undefined, { numeric: true }),
    );
}

function matchesSidebar(
  row: unknown[],
  balBill: BalBillFilter,
  status: string,
  clearance: string[],
  item: string,
  size: string,
  pn: string,
  balBillIdx: number,
  clearanceIdx: number,
  exclude?: "balBill" | "status" | "clearance" | "item" | "size" | "pn",
): boolean {
  if (exclude !== "balBill" && balBill !== "all") {
    const isYes = isZeroBal(row[balBillIdx]);
    const ok = balBill === "yes" ? isYes : !isYes;
    if (!ok) return false;
  }
  if (exclude !== "status" && status !== "all") {
    if (status === "Completed") {
      if (!isZeroBal(row[balBillIdx])) return false;
    } else if (status === "Blanks") {
      if (String(row[balBillIdx] ?? "").trim() !== "") return false;
    } else {
      const cell = String(row[clearanceIdx] ?? "").trim();
      if (cell !== status) return false;
    }
  }
  if (exclude !== "clearance" && clearance.length > 0) {
    const cell = String(row[clearanceIdx] ?? "").trim();
    const isBlank = cell === "";
    const matchesBlank = clearance.includes("(Blank)") && isBlank;
    const matchesVal = clearance.includes(cell);
    if (!(matchesBlank || matchesVal)) return false;
  }
  if (
    exclude !== "item" &&
    item &&
    String(row[ITEM_IDX] ?? "").trim() !== item
  ) {
    return false;
  }
  if (
    exclude !== "size" &&
    size &&
    String(row[SIZE_IDX] ?? "").trim() !== size
  ) {
    return false;
  }
  if (exclude !== "pn" && pn && String(row[PN_IDX] ?? "").trim() !== pn) {
    return false;
  }
  return true;
}

function parseDateCR(str: string): Date | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const mon = months[m[2].toLowerCase()];
    if (mon !== undefined) {
      const day = parseInt(m[1], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      if (!isNaN(day) && day >= 1 && day <= 31 && !isNaN(year)) {
        return new Date(year, mon, day);
      }
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function matchesTableFilters(
  row: unknown[],
  headers: string[],
  columnFilters: Record<string, string>,
  multiFilters: Record<string, string[]>,
  globalSearch: string,
  dateFrom?: string,
  dateTo?: string,
  excludeHeader?: string,
): boolean {
  if (globalSearch.trim()) {
    const q = globalSearch.toLowerCase();
    const hay = headers
      .map((_, i) => String(row[i] ?? "").toLowerCase())
      .join(" ");
    if (!hay.includes(q)) return false;
  }
  for (const [colName, filterVal] of Object.entries(columnFilters)) {
    if (excludeHeader && colName === excludeHeader) continue;
    if (!filterVal || filterVal === "All") continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "");
    if (filterVal === "(Blank)") {
      if (cellVal !== "") return false;
    } else if (!cellVal.toLowerCase().includes(filterVal.toLowerCase())) {
      return false;
    }
  }
  for (const [colName, selected] of Object.entries(multiFilters)) {
    if (excludeHeader && colName === excludeHeader) continue;
    if (!selected.length) continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "").trim();
    const matchesBlank = selected.includes("(Blank)") && cellVal === "";
    if (!(matchesBlank || selected.includes(cellVal))) return false;
  }
  if (dateFrom || dateTo) {
    const dateColIdx = (() => {
      const candidates = new Set(["Date", "expiryDate"]);
      for (const cand of candidates) {
        const idx = headers.indexOf(cand);
        if (idx !== -1) return idx;
      }
      return headers.findIndex((h) => h.toLowerCase().includes("date"));
    })();
    if (dateColIdx !== -1) {
      const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
      const toEnd = dateTo ? new Date(dateTo + "T23:59:59") : null;
      const dateStr = String(row[dateColIdx] ?? "");
      if (!dateStr) return false;
      const date = parseDateCR(dateStr);
      if (!date) return false;
      if (fromDate && date < fromDate) return false;
      if (toEnd && date > toEnd) return false;
    }
  }
  return true;
}

export default function ContractReviewPage() {
  const [data, setData] = useState<ContractReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [balBillFilter, setBalBillFilter] = useState<BalBillFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clearanceOpen, setClearanceOpen] = useState(false);
  const clearanceRef = useRef<HTMLDivElement>(null);
  const [tileItem, setTileItem] = useState("");
  const [tileSize, setTileSize] = useState("");
  const [tilePn, setTilePn] = useState("");
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const [pnRatingOptions, setPnRatingOptions] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>(
    {},
  );
  const [globalSearch, setGlobalSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filterState = useMemo(
    () => ({
      columnFilters,
      multiFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    }),
    [
      columnFilters,
      multiFilters,
      dateFrom,
      dateTo,
      globalSearch,
      currentPage,
      pageSize,
    ],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        setColumnFilters((prev) => ({ ...prev, [header]: value })),
      onMultiFilter: (header: string, values: string[]) =>
        setMultiFilters((prev) => {
          const next = { ...prev };
          if (values.length) next[header] = values;
          else delete next[header];
          return next;
        }),
      onDateFrom: setDateFrom,
      onDateTo: setDateTo,
      onGlobalSearch: setGlobalSearch,
      onResetFilters: () => {
        setColumnFilters({});
        setMultiFilters({});
        setGlobalSearch("");
        setDateFrom("");
        setDateTo("");
      },
      onPageChange: setCurrentPage,
      onPageSizeChange: setPageSize,
    }),
    [],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contract-review");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      if (json.bomIdOptions) setBomIdOptionsById(json.bomIdOptions);
      if (json.pnRatingOptions) setPnRatingOptions(json.pnRatingOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/contract-review/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const balBillIdx = data ? headers.indexOf("BAL BILL AG CONT") : -1;
  const clearanceIdx = data ? headers.indexOf("CLEARANCE STATUS") : -1;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        clearanceRef.current &&
        !clearanceRef.current.contains(e.target as Node)
      ) {
        setClearanceOpen(false);
      }
    }
    if (clearanceOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clearanceOpen]);

  // Single source of truth: sidebar CLEARANCE STATUS mirrors column multiFilters["CLEARANCE STATUS"]
  const clearanceFilter = multiFilters["CLEARANCE STATUS"] ?? [];

  const handleSelectBomId = useCallback(
    (id: string, bomId: string | null) => {
      toast.promise(selectContractReviewBomIdAction(id, bomId), {
        loading: "Saving BOM ID...",
        success: (res) => {
          if (res?.success) {
            setData((prev) => {
              if (!prev) return prev;
              const itemTypeIdx = headers.indexOf("ITEM TYPE");
              const rows = prev.rows.map((row, i) => {
                if (prev.ids[i] !== id) return row;
                const next = [...row];
                next[BOM_ID_IDX] = bomId ?? "";
                const itemTypeVal = res.data?.itemType;
                if (itemTypeVal !== undefined && itemTypeIdx !== -1) {
                  next[itemTypeIdx] = itemTypeVal;
                }
                const noUseVal = res.data?.noUse ?? "";
                if (NO_USE_IDX !== -1) {
                  next[NO_USE_IDX] = noUseVal;
                }
                return next;
              });
              return { ...prev, rows };
            });
            return "BOM ID saved";
          }
          return res?.error || "Failed to save BOM ID";
        },
        error: (err) => err || "Failed to save BOM ID",
      });
    },
    [headers],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = CONTRACT_REVIEW_HEADER_TO_DB_FIELD[header];
      if (!field) return;
      await toast.promise(
        updateContractReviewFieldAction(id, field, value || null),
        {
          loading: `Updating ${header}...`,
          success: (res) => {
            if (res?.success) {
              setData((prev) => {
                if (!prev) return prev;
                const rows = prev.rows.map((row, i) => {
                  if (prev.ids[i] !== id) return row;
                  const next = [...row];
                  next[colIndex] = value;
                  return next;
                });
                return { ...prev, rows };
              });
              return `${header} updated`;
            }
            return res?.error || `Failed to update ${header}`;
          },
          error: (err) => err || `Failed to update ${header}`,
        },
      );
    },
    [headers],
  );

  const autoSavedBomIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const pending: { id: string; bomId: string }[] = [];
    const pendingActuator: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoSavedBomIdsRef.current.has(id)) return;
      if (String(row[BOM_ID_IDX] ?? "").trim() !== "") return;
      const options = bomIdOptionsById[id];
      if (!options || options.length === 0) return;
      if (options.length === 1) {
        autoSavedBomIdsRef.current.add(id);
        pending.push({ id, bomId: options[0] });
        return;
      }
      const actuator = ACTUATOR_IDX !== -1 ? String(row[ACTUATOR_IDX] ?? "") : "";
      if (actuator.includes("@")) {
        autoSavedBomIdsRef.current.add(id);
        pendingActuator.push(id);
      }
    });
    const itemTypeIdx = headers.indexOf("ITEM TYPE");
    for (const { id, bomId } of pending) {
      selectContractReviewBomIdAction(id, bomId).then((res) => {
        if (!res?.success) return;
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((row, i) => {
              if (prev.ids[i] !== id) return row;
              const next = [...row];
              next[BOM_ID_IDX] = bomId;
              if (res.data?.itemType !== undefined && itemTypeIdx !== -1) {
                next[itemTypeIdx] = res.data.itemType;
              }
              if (NO_USE_IDX !== -1) {
                next[NO_USE_IDX] = res.data?.noUse ?? "";
              }
              return next;
            }),
          };
        });
      });
    }
    if (pendingActuator.length > 0) {
      autoAssignContractReviewBomIdFromActuator(pendingActuator).then((res) => {
        if (!res?.success) return;
        setData((prev) => {
          if (!prev) return prev;
          const map = new Map(
            (res.data ?? []).map((d) => [d.id, d]),
          );
          return {
            ...prev,
            rows: prev.rows.map((row, i) => {
              const d = map.get(prev.ids[i]);
              if (!d) return row;
              const next = [...row];
              next[BOM_ID_IDX] = d.bomId;
              if (itemTypeIdx !== -1) next[itemTypeIdx] = d.itemType;
              if (NO_USE_IDX !== -1) next[NO_USE_IDX] = d.noUse ?? "";
              return next;
            }),
          };
        });
      });
    }
  }, [data, bomIdOptionsById, headers]);

  const autoNoUseRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoNoUseRef.current.has(id)) return;
      if (String(row[BOM_ID_IDX] ?? "").trim() === "") return;
      autoNoUseRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    backfillContractReviewNoUseBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map(
          (res.data ?? []).map((d) => [d.id, d.noUse ?? ""]),
        );
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined || NO_USE_IDX === -1) return row;
            const next = [...row];
            next[NO_USE_IDX] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const categoryOptions = useMemo<Record<string, string[]>>(() => {
    if (!data) return {};
    const items = [
      ...new Set(
        data.rows.map((r) => String(r[ITEM_IDX] ?? "").trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const result: Record<string, string[]> = {};
    if (items.length) result.Item = items;
    // Pure row-value distinct for CLEARANCE STATUS (plus (Blank) handled by MultiSelect)
    result["CLEARANCE STATUS"] = [
      ...new Set(
        data.rows.map((r) => String(r[clearanceIdx] ?? "").trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return result;
  }, [data, clearanceIdx]);

  const allRows = data?.rows ?? [];

  const sidebarBaseRows = useMemo(
    () =>
      allRows.filter((row) =>
        matchesTableFilters(
          row,
          headers,
          columnFilters,
          multiFilters,
          globalSearch,
          dateFrom,
          dateTo,
        ),
      ),
    [allRows, headers, columnFilters, multiFilters, globalSearch, dateFrom, dateTo],
  );

  const balBillCounts = useMemo(() => {
    if (balBillIdx === -1) return { all: 0, yes: 0, no: 0 };
    let all = 0;
    let yes = 0;
    for (const row of sidebarBaseRows) {
      if (
        !matchesSidebar(
          row,
          "all",
          statusFilter,
          clearanceFilter,
          tileItem,
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          "balBill",
        )
      )
        continue;
      all++;
      if (isZeroBal(row[balBillIdx])) yes++;
    }
    return { all, yes, no: all - yes };
  }, [
    sidebarBaseRows,
    statusFilter,
    clearanceFilter,
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      Blanks: 0,
      Closed: 0,
      Completed: 0,
      Duplicate: 0,
      Hold: 0,
      Shortclosed: 0,
      "To be closed": 0,
    };
    for (const row of sidebarBaseRows) {
      if (
        !matchesSidebar(
          row,
          balBillFilter,
          "all",
          clearanceFilter,
          tileItem,
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          "status",
        )
      )
        continue;
      counts.all++;
      if (isZeroBal(row[balBillIdx])) {
        counts.Completed++;
        continue;
      }
      const balBlank = String(row[balBillIdx] ?? "").trim() === "";
      const cell = String(row[clearanceIdx] ?? "").trim();
      const key = balBlank ? "Blanks" : cell;
      if (key in counts) counts[key]++;
    }
    return counts;
  }, [
    sidebarBaseRows,
    balBillFilter,
    clearanceFilter,
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  // Cascading multi-select clearance filter: counts exclude own selection (exclude-self)
  // like item/size/pn/balBill/status. "(Blank)" represents empty string.
  // Bidirectional: also exclude column's CLEARANCE STATUS filter (same logical filter synced)
  const clearanceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    const baseForClearance = allRows.filter((row) =>
      matchesTableFilters(row, headers, columnFilters, multiFilters, globalSearch, dateFrom, dateTo, "CLEARANCE STATUS"),
    );
    for (const row of baseForClearance) {
      if (
        !matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          [],
          tileItem,
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          "clearance",
        )
      )
        continue;
      counts.all++;
      const cell = String(row[clearanceIdx] ?? "").trim();
      const key = cell === "" ? "(Blank)" : cell;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [
    allRows,
    headers,
    columnFilters,
    multiFilters,
    globalSearch,
    dateFrom,
    dateTo,
    balBillFilter,
    statusFilter,
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  const clearanceOptions = useMemo(() => {
    const keys = Object.keys(clearanceCounts).filter((k) => k !== "all");
    // Always include (Blank) like table column filter does, even if count 0 (cascading still shows 0)
    if (!keys.includes("(Blank)")) keys.push("(Blank)");
    // Keep selected values visible even if count 0 (bidirectional cascading keep-selected)
    for (const s of clearanceFilter) {
      if (s !== "(Blank)" && !keys.includes(s)) keys.push(s);
    }
    return keys.sort((a, b) => {
      if (a === "(Blank)") return 1;
      if (b === "(Blank)") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [clearanceCounts, clearanceFilter]);

  const itemOptions = useMemo(
    () =>
      groupCount(sidebarBaseRows, ITEM_IDX, (row) =>
        matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          clearanceFilter,
          "",
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          "item",
        ),
      ),
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileSize,
      tilePn,
      balBillIdx,
      clearanceIdx,
    ],
  );

  const sizeOptions = useMemo(
    () =>
      groupCount(sidebarBaseRows, SIZE_IDX, (row) =>
        matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          clearanceFilter,
          tileItem,
          "",
          tilePn,
          balBillIdx,
          clearanceIdx,
          "size",
        ),
      ),
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItem,
      tilePn,
      balBillIdx,
      clearanceIdx,
    ],
  );

  const pnOptions = useMemo(
    () =>
      groupCount(sidebarBaseRows, PN_IDX, (row) =>
        matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          clearanceFilter,
          tileItem,
          tileSize,
          "",
          balBillIdx,
          clearanceIdx,
          "pn",
        ),
      ),
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItem,
      tileSize,
      balBillIdx,
      clearanceIdx,
    ],
  );

  const rateMcCont = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const row of sidebarBaseRows) {
      if (
        !matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          clearanceFilter,
          tileItem,
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          undefined,
        )
      )
        continue;
      const rate = parseFloat(String(row[RATE_IDX] ?? "").replace(/,/g, ""));
      const qty = parseFloat(String(row[MC_QTY_IDX] ?? "").replace(/,/g, ""));
      if (isNaN(rate) || isNaN(qty)) continue;
      sum += rate * qty;
      count++;
    }
    return { sum, count };
  }, [
    sidebarBaseRows,
    balBillFilter,
    statusFilter,
    clearanceFilter,
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  const rateTile = useCallback(
    (rateIdx: number, qtyIdx: number, subIdx?: number) => {
      let sum = 0;
      let count = 0;
      for (const row of sidebarBaseRows) {
        if (
          !matchesSidebar(
            row,
            balBillFilter,
            statusFilter,
            clearanceFilter,
            tileItem,
            tileSize,
            tilePn,
            balBillIdx,
            clearanceIdx,
            undefined,
          )
        )
          continue;
        const rate = parseNum(row[rateIdx]);
        const qty = parseNum(row[qtyIdx]);
        if (subIdx !== undefined) {
          const sub = parseNum(row[subIdx]);
          if (isNaN(rate) || isNaN(qty) || isNaN(sub)) continue;
          sum += rate * (qty - sub);
        } else {
          if (isNaN(rate) || isNaN(qty)) continue;
          sum += rate * qty;
        }
        count++;
      }
      return { sum, count };
    },
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItem,
      tileSize,
      tilePn,
      balBillIdx,
      clearanceIdx,
    ],
  );

  const rateBalBillCont = useMemo(
    () => rateTile(RATE_IDX, BAL_BILL_AG_CONT_IDX),
    [rateTile],
  );

  const rateOrderQty = useMemo(
    () => rateTile(RATE_IDX, ORDER_QTY_IDX),
    [rateTile],
  );

  const rateBalDiQty = useMemo(
    () => rateTile(RATE_IDX, DI_QTY_IDX, BILLED_QTY_IDX),
    [rateTile],
  );

  const rateBalMspQty = useMemo(
    () => rateTile(RATE_IDX, MC_QTY_IDX, DI_QTY_IDX),
    [rateTile],
  );

  const tileRowsCount = useMemo(
    () =>
      sidebarBaseRows.reduce(
        (n, row) =>
          n +
          (matchesSidebar(
            row,
            balBillFilter,
            statusFilter,
            clearanceFilter,
            tileItem,
            tileSize,
            tilePn,
            balBillIdx,
            clearanceIdx,
            undefined,
          )
            ? 1
            : 0),
        0,
      ),
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItem,
      tileSize,
      tilePn,
      balBillIdx,
      clearanceIdx,
    ],
  );

  const hasTileFilter = tileItem !== "" || tileSize !== "" || tilePn !== "";

  const filteredData = useMemo(() => {
    if (
      !data ||
      (!hasTileFilter &&
        balBillFilter === "all" &&
        statusFilter === "all" &&
        clearanceFilter.length === 0)
    ) {
      return data;
    }
    const rows: unknown[][] = [];
    const filteredIds: string[] = [];
    data.rows.forEach((row, i) => {
      if (
        !matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
          clearanceFilter,
          tileItem,
          tileSize,
          tilePn,
          balBillIdx,
          clearanceIdx,
          undefined,
        )
      )
        return;
      rows.push(row);
      filteredIds.push(data.ids[i]);
    });
    return { ...data, rows, ids: filteredIds, totalRows: rows.length };
  }, [
    data,
    hasTileFilter,
    balBillFilter,
    statusFilter,
    clearanceFilter,
    balBillIdx,
    clearanceIdx,
    tileItem,
    tileSize,
    tilePn,
  ]);

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const tileAllCounts = useMemo(
    () => ({
      item: sidebarBaseRows.reduce(
        (n, r) =>
          n +
          (matchesSidebar(
            r,
            balBillFilter,
            statusFilter,
            clearanceFilter,
            "",
            tileSize,
            tilePn,
            balBillIdx,
            clearanceIdx,
            "item",
          )
            ? 1
            : 0),
        0,
      ),
      size: sidebarBaseRows.reduce(
        (n, r) =>
          n +
          (matchesSidebar(
            r,
            balBillFilter,
            statusFilter,
            clearanceFilter,
            tileItem,
            "",
            tilePn,
            balBillIdx,
            clearanceIdx,
            "size",
          )
            ? 1
            : 0),
        0,
      ),
      pn: sidebarBaseRows.reduce(
        (n, r) =>
          n +
          (matchesSidebar(
            r,
            balBillFilter,
            statusFilter,
            clearanceFilter,
            tileItem,
            tileSize,
            "",
            balBillIdx,
            clearanceIdx,
            "pn",
          )
            ? 1
            : 0),
        0,
      ),
    }),
    [
      sidebarBaseRows,
      balBillFilter,
      statusFilter,
      clearanceFilter,
      tileItem,
      tileSize,
      tilePn,
      balBillIdx,
      clearanceIdx,
    ],
  );

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex p-6 min-h-0 gap-4">
        <aside className="w-64 shrink-0 self-stretch min-h-0 max-h-full overflow-y-auto overscroll-contain bg-[#0a2540] border border-[#1e3d59] rounded-lg shadow-sm p-4 flex flex-col gap-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent pr-3">
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            Filters
          </span>
          {/* <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              BAL BILL AG CONT
            </span>
            <select
              value={balBillFilter}
              onChange={(e) =>
                setBalBillFilter(e.target.value as BalBillFilter)
              }
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All ({balBillCounts.all})</option>
              <option value="yes">Yes (0) ({balBillCounts.yes})</option>
              <option value="no">No ({balBillCounts.no})</option>
            </select>
          </div> */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              STATUS
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All ({statusCounts.all})</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} ({statusCounts[opt] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5" ref={clearanceRef}>
            <span className="text-[11px] font-semibold text-white/60">
              CLEARANCE STATUS
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setClearanceOpen((v) => !v)}
                className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {clearanceFilter.length === 0
                    ? `All (${clearanceCounts.all ?? 0})`
                    : `${clearanceFilter.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 shrink-0">
                  {clearanceOpen ? "▲" : "▼"}
                </span>
              </button>
              {clearanceOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-[#e1e6eb] rounded shadow-lg overflow-hidden">
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-[#e1e6eb] bg-[#f8f9fa]">
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter("CLEARANCE STATUS", [
                          ...clearanceOptions,
                        ])
                      }
                      className="text-blue-600 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter("CLEARANCE STATUS", [])
                      }
                      className="text-red-600 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {clearanceOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      clearanceOptions.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[11px] text-[#0a2540]"
                        >
                          <input
                            type="checkbox"
                            checked={clearanceFilter.includes(opt)}
                            onChange={() => {
                              filterActions.onMultiFilter(
                                "CLEARANCE STATUS",
                                clearanceFilter.includes(opt)
                                  ? clearanceFilter.filter((v) => v !== opt)
                                  : [...clearanceFilter, opt],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span
                            className={`truncate flex-1 ${opt === "(Blank)" ? "italic text-gray-400" : ""}`}
                          >
                            {opt}
                          </span>
                          <span className="text-[10px] text-[#0a2540]/50 shrink-0">
                            ({clearanceCounts[opt] ?? 0})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <span className="text-xs font-bold uppercase tracking-wider text-white mt-2">
            Breakdown
          </span>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              Item
            </span>
            <select
              value={tileItem}
              onChange={(e) => setTileItem(e.target.value)}
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All ({tileAllCounts.item})</option>
              {itemOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              Size
            </span>
            <select
              value={tileSize}
              onChange={(e) => setTileSize(e.target.value)}
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All ({tileAllCounts.size})</option>
              {sizeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              PN Rating
            </span>
            <select
              value={tilePn}
              onChange={(e) => setTilePn(e.target.value)}
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All ({tileAllCounts.pn})</option>
              {pnOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × MC QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateMcCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateMcCont.count} rows of {tileRowsCount}
            </span>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL BILL AG CONT
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalBillCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalBillCont.count} rows of {tileRowsCount}
            </span>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × ORDER QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateOrderQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateOrderQty.count} rows of {tileRowsCount}
            </span>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × (DI QTY - BILLED QTY)
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              BAL DI QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalDiQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalDiQty.count} rows of {tileRowsCount}
            </span>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × (MC QTY - DI QTY)
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              BAL MC QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalMspQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalMspQty.count} rows of {tileRowsCount}
            </span>
          </div>
        </aside>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <GMDUpdateHeader
            title="CONTRACT REVIEW"
            totalRows={data?.totalRows ?? 0}
            syncedAt={data?.syncedAt ?? undefined}
            onSync={handleSync}
            syncing={syncing}
          />
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1 mt-4">
            <GMDUpdateTable
              headers={headers}
              rows={filteredData?.rows ?? []}
              ids={filteredData?.ids ?? []}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title="Contract Review"
              editable
              editableColumns={["bom formula trial", "Item", "BOM ID", "CLEARANCE STATUS"]}
              categoryOptions={categoryOptions}
              fixedDropdownOptions={pnRatingOptions.length ? { "PN RATING": pnRatingOptions } : undefined}
              onCellUpdate={handleCellUpdate}
              externalFiltersActive={
                hasTileFilter ||
                balBillFilter !== "all" ||
                statusFilter !== "all" ||
                clearanceFilter.length > 0
              }
              filterState={filterState}
              filterActions={filterActions}
              bomIdOptionsById={bomIdOptionsById}
              onSelectBomId={handleSelectBomId}
              bomIdCategoryFilter
              onReset={() => {
                setTileItem("");
                setTileSize("");
                setTilePn("");
                setBalBillFilter("all");
                setStatusFilter("all");
                filterActions.onMultiFilter("CLEARANCE STATUS", []);
              }}
              hiddenColumns={[
                "VA %",
                "CV",
                "FREE STOCK",
                "FINAL REQ",
                // "MC QTY",
                "Balance mc",
                "PROD ORD QTY",
                "BALANCE TO PROD ORD",
                "BALANCE TO PROD ENT",
                // "DI QTY",
                "BAL DI QTY",
                "BAL MC VAL",
                "BAL PROD ORD VAL",
                "BAL TO PROD ORD ENT VAL",
                "BAL BILL AG CONT VAL",
                "BAL BILL AG MC VAL",
                "BAL DI VAL",
                "DI VAL",
                "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
                "JOB Code",
                "BAL BILL AG MC",
                "ic qty",
                "bom formula trial",
              ]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
