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
  backfillContractReviewOrderListBatchAction,
  backfillContractReviewCostFromQuotationAction,
  autoAssignContractReviewBomIdFromActuator,
  getActuatorOptionsAction,
  saveActuatorWithRmCodeAction,
} from "@/app/actions";
import {
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
  CONTRACT_REVIEW_HEADERS,
} from "@/lib/gmd_lib/contract-review-columns";
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_ZERO,
  FLOW_NON_ZERO,
  cellHasValue,
  cellIsZero,
} from "@/lib/gmd_lib/flowFilter";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useDefaultLayout } from "react-resizable-panels";
import { FlowDiagram } from "@/components/graph_flow/FlowDiagram";
import {
  CONTRACT_REVIEW_TREES,
  flatten,
  pathTo,
  type FlowFilter,
} from "@/components/graph_flow/tree";

const layoutStorage = {
  getItem: (key: string) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};

interface ContractReviewData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
}

type BalBillFilter = "all" | "yes" | "no";

function statusTitle(value: string): string {
  const s = value.trim();
  if (!s) return "Blanks";
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

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
const RM_CODE_FOR_ACTUATOR_IDX = CONTRACT_REVIEW_HEADERS.indexOf(
  "RM CODE FOR ACTUATOR",
);
const ORDER_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ORDER QTY");
const DI_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("DI QTY");
const BILLED_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BILLED QTY");
const BAL_BILL_AG_CONT_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("BAL BILL AG CONT");
const STATUS_IDX = CONTRACT_REVIEW_HEADERS.indexOf("STATUS");
const ORDER_LIST_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ORDER LIST");
const ITEM_NAME_IDX = CONTRACT_REVIEW_HEADERS.indexOf("ITEM_NAME");
const VA_PCT_FROM_COST_IDX = CONTRACT_REVIEW_HEADERS.indexOf("VA % FROM COST");
const COST_FROM_QUOTATION_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf("COST FROM QUOTATION");
const CONTRACT_NO_IDX = CONTRACT_REVIEW_HEADERS.indexOf("CONTRACT NO");

type RateTileKey =
  | "rateXOrderQty"
  | "rateXBalBillAgCont"
  | "rateXMcQty"
  | "rateXBalDiQty"
  | "rateXBalMcQty"
  | "balBillAgContSum"
  | "totalCostExcGst"
  | "totalCostIncGst"
  | "totalVaPct";

function isNumIdx(row: unknown[], idx: number): boolean {
  return !isNaN(parseNum(row[idx]));
}

function matchesRateTile(row: unknown[], key: RateTileKey | null): boolean {
  if (!key) return true;
  switch (key) {
    case "rateXOrderQty":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, ORDER_QTY_IDX);
    case "rateXBalBillAgCont":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, BAL_BILL_AG_CONT_IDX);
    case "rateXMcQty":
      return isNumIdx(row, RATE_IDX) && isNumIdx(row, MC_QTY_IDX);
    case "rateXBalDiQty":
      return (
        isNumIdx(row, RATE_IDX) &&
        isNumIdx(row, DI_QTY_IDX) &&
        isNumIdx(row, BILLED_QTY_IDX)
      );
    case "rateXBalMcQty":
      return (
        isNumIdx(row, RATE_IDX) &&
        isNumIdx(row, MC_QTY_IDX) &&
        isNumIdx(row, DI_QTY_IDX)
      );
    case "balBillAgContSum":
      return isNumIdx(row, BAL_BILL_AG_CONT_IDX);
    case "totalCostExcGst":
    case "totalCostIncGst":
      return isNumIdx(row, COST_FROM_QUOTATION_IDX);
    case "totalVaPct":
      return isNumIdx(row, VA_PCT_FROM_COST_IDX);
    default:
      return true;
  }
}

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
    const cell = String(row[STATUS_IDX] ?? "").trim();
    if (status === "Blanks") {
      if (cell !== "") return false;
    } else if (cell.toLowerCase() !== status.toLowerCase()) {
      return false;
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
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
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
  dateRanges?: Record<string, { from: string; to: string }>,
  excludeHeader?: string,
  ignoreColumns?: Set<string>,
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
    if (ignoreColumns?.has(colName)) continue;
    if (!filterVal || filterVal === "All") continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "");
    if (
      filterVal === "(Blank)" ||
      filterVal === "-" ||
      filterVal === "—"
    ) {
      if (cellVal !== "") return false;
    } else if (!cellVal.toLowerCase().includes(filterVal.toLowerCase())) {
      return false;
    }
  }
  for (const [colName, selected] of Object.entries(multiFilters)) {
    if (excludeHeader && colName === excludeHeader) continue;
    if (ignoreColumns?.has(colName)) continue;
    if (!selected.length) continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "").trim();
    const matchesBlank = selected.includes("(Blank)") && cellVal === "";
    const matchesHasValue =
      selected.includes(FLOW_HAS_VALUE) && cellHasValue(cellVal);
    const matchesNoValue =
      selected.includes(FLOW_NO_VALUE) && !cellHasValue(cellVal);
    const matchesZero = selected.includes(FLOW_ZERO) && cellIsZero(cellVal);
    const matchesNonZero =
      selected.includes(FLOW_NON_ZERO) && !cellIsZero(cellVal);
    if (
      !(
        matchesBlank ||
        matchesHasValue ||
        matchesNoValue ||
        matchesZero ||
        matchesNonZero ||
        selected.includes(cellVal)
      )
    )
      return false;
  }
  if (dateRanges) {
    for (const [colName, r] of Object.entries(dateRanges)) {
      if (excludeHeader && colName === excludeHeader) continue;
      if (ignoreColumns?.has(colName)) continue;
      if (!r.from && !r.to) continue;
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) continue;
      const dateStr = String(row[colIdx] ?? "");
      if (!dateStr) return false;
      const date = parseDateCR(dateStr);
      if (!date) return false;
      const fromDate = r.from ? new Date(r.from + "T00:00:00") : null;
      const toEnd = r.to ? new Date(r.to + "T23:59:59") : null;
      if (fromDate && date < fromDate) return false;
      if (toEnd && date > toEnd) return false;
    }
  }
  return true;
}

/** Whether a row satisfies a single graph node filter (exact cell match). */
function matchesGraphFilter(row: unknown[], filter: FlowFilter): boolean {
  const colIdx = (CONTRACT_REVIEW_HEADERS as readonly string[]).indexOf(
    filter.column,
  );
  // Column not in the data yet (e.g. DI Received / Dispatch / DI Balance):
  // pass through so partially-built tree levels don't zero out the subtree.
  if (colIdx === -1) return true;
  const cell = String(row[colIdx] ?? "").trim();
  const matchesBlank = filter.values.includes("(Blank)") && cell === "";
  const matchesHasValue =
    filter.values.includes(FLOW_HAS_VALUE) && cellHasValue(cell);
  const matchesNoValue =
    filter.values.includes(FLOW_NO_VALUE) && !cellHasValue(cell);
  const matchesZero = filter.values.includes(FLOW_ZERO) && cellIsZero(cell);
  const matchesNonZero =
    filter.values.includes(FLOW_NON_ZERO) && !cellIsZero(cell);
  return (
    matchesBlank ||
    matchesHasValue ||
    matchesNoValue ||
    matchesZero ||
    matchesNonZero ||
    filter.values.includes(cell)
  );
}

/** Reduce a node path to one constraint per column (last level wins). */
function pathToColumnFilters(
  path: { filter: FlowFilter }[],
): Record<string, string[]> {
  const byCol: Record<string, string[]> = {};
  for (const node of path) {
    // Skip columns that don't exist yet — they can't filter the table.
    if (
      !(CONTRACT_REVIEW_HEADERS as readonly string[]).includes(
        node.filter.column,
      )
    )
      continue;
    byCol[node.filter.column] = node.filter.values;
  }
  return byCol;
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
  const [activeRateTile, setActiveRateTile] = useState<RateTileKey | null>(
    null,
  );
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const [actuatorOptions, setActuatorOptions] = useState<string[]>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>(
    {},
  );
  const [globalSearch, setGlobalSearch] = useState("");
  const [dateRanges, setDateRanges] = useState<
    Record<string, { from: string; to: string }>
  >({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activePath, setActivePath] = useState<string[]>([]);

  const {
    defaultLayout: verticalLayout,
    onLayoutChanged: onVerticalLayoutChanged,
  } = useDefaultLayout({
    id: "contract-review-vertical",
    panelIds: ["graph", "table"],
    storage: layoutStorage,
  });

  const filterState = useMemo(
    () => ({
      columnFilters,
      multiFilters,
      dateRanges,
      globalSearch,
      currentPage,
      pageSize,
    }),
    [
      columnFilters,
      multiFilters,
      dateRanges,
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
      onDateRange: (header: string, from: string, to: string) =>
        setDateRanges((prev) => {
          const next = { ...prev };
          if (from || to) next[header] = { from, to };
          else delete next[header];
          return next;
        }),
      onGlobalSearch: setGlobalSearch,
      onResetFilters: () => {
        setColumnFilters({});
        setMultiFilters({});
        setGlobalSearch("");
        setDateRanges({});
        setActiveRateTile(null);
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

  useEffect(() => {
    getActuatorOptionsAction().then((res) => {
      if (res.success && res.data) setActuatorOptions(res.data);
    });
  }, []);

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
    if (clearanceOpen)
      document.addEventListener("mousedown", handleClickOutside);
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
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        if (header === "Actuator") {
          const res = await saveActuatorWithRmCodeAction(id, value || null);
          if (res?.success && res.data) {
            const d = res.data;
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                rows: prev.rows.map((row, i) => {
                  if (prev.ids[i] !== id) return row;
                  const next = [...row];
                  if (ACTUATOR_IDX !== -1)
                    next[ACTUATOR_IDX] = d.actuator ?? "";
                  if (RM_CODE_FOR_ACTUATOR_IDX !== -1)
                    next[RM_CODE_FOR_ACTUATOR_IDX] = d.rmCodeForActuator ?? "";
                  return next;
                }),
              };
            });
            toast.success(`${header} updated`, { id: toastId });
          } else {
            toast.error(res?.error || `Failed to update ${header}`, {
              id: toastId,
            });
          }
          return;
        }
        const res = await updateContractReviewFieldAction(
          id,
          field,
          value || null,
        );
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
          toast.success(`${header} updated`, { id: toastId });
        } else {
          toast.error(res?.error || `Failed to update ${header}`, {
            id: toastId,
          });
        }
      } catch (err: any) {
        toast.error(err?.message || `Failed to update ${header}`, {
          id: toastId,
        });
      }
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
      const actuator =
        ACTUATOR_IDX !== -1 ? String(row[ACTUATOR_IDX] ?? "") : "";
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
          const map = new Map((res.data ?? []).map((d) => [d.id, d]));
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
        const map = new Map((res.data ?? []).map((d) => [d.id, d.noUse ?? ""]));
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

  const autoOrderListRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data || ORDER_LIST_IDX === -1) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoOrderListRef.current.has(id)) return;
      if (String(row[ORDER_LIST_IDX] ?? "").trim() !== "") return;
      autoOrderListRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    backfillContractReviewOrderListBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map(
          (res.data ?? []).map((d) => [d.id, (d.orderList ?? []).join(", ")]),
        );
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined || v === "") return row;
            const next = [...row];
            next[ORDER_LIST_IDX] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const autoCostFromQuotationRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data || VA_PCT_FROM_COST_IDX === -1) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoCostFromQuotationRef.current.has(id)) return;
      if (String(row[CONTRACT_NO_IDX] ?? "").trim() === "") return;
      autoCostFromQuotationRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    backfillContractReviewCostFromQuotationAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map(
          (res.data ?? []).map((d) => [
            d.id,
            d.vaPercentfromcost ?? "",
          ]),
        );
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined) return row;
            const next = [...row];
            next[VA_PCT_FROM_COST_IDX] = v;
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
        data.rows
          .map((r) => String(r[clearanceIdx] ?? "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    result["PN RATING"] = [
      ...new Set(
        data.rows.map((r) => String(r[PN_IDX] ?? "").trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return result;
  }, [data, clearanceIdx]);

  const allRows = data?.rows ?? [];

  const sidebarBaseRows = useMemo(
    () =>
      allRows.filter(
        (row) =>
          matchesTableFilters(
            row,
            headers,
            columnFilters,
            multiFilters,
            globalSearch,
            dateRanges,
          ) && matchesRateTile(row, activeRateTile),
      ),
    [
      allRows,
      headers,
      columnFilters,
      multiFilters,
      globalSearch,
      dateRanges,
      activeRateTile,
    ],
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
    const counts: Record<string, number> = { all: 0 };
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
      const cell = String(row[STATUS_IDX] ?? "").trim();
      const key = cell === "" ? "Blanks" : statusTitle(cell);
      counts[key] = (counts[key] ?? 0) + 1;
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
    STATUS_IDX,
  ]);

  const statusOptions = useMemo(() => {
    return Object.keys(statusCounts)
      .filter((k) => k !== "all")
      .sort((a, b) =>
        a === "Blanks"
          ? -1
          : b === "Blanks"
            ? 1
            : a.localeCompare(b, undefined, { numeric: true }),
      );
  }, [statusCounts]);

  // Cascading multi-select clearance filter: counts exclude own selection (exclude-self)
  // like item/size/pn/balBill/status. "(Blank)" represents empty string.
  // Bidirectional: also exclude column's CLEARANCE STATUS filter (same logical filter synced)
  const clearanceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    const baseForClearance = allRows.filter(
      (row) =>
        matchesTableFilters(
          row,
          headers,
          columnFilters,
          multiFilters,
          globalSearch,
          dateRanges,
          "CLEARANCE STATUS",
        ) && matchesRateTile(row, activeRateTile),
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
    dateRanges,
    activeRateTile,
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

  const balBillAgContTotal = useMemo(() => {
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
      const v = parseNum(row[BAL_BILL_AG_CONT_IDX]);
      if (isNaN(v)) continue;
      sum += v;
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

  const totalCostExcGst = useMemo(() => {
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
      const c = parseNum(row[COST_FROM_QUOTATION_IDX]);
      if (isNaN(c)) continue;
      sum += c;
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

  const totalCostIncGst = useMemo(() => {
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
      const c = parseNum(row[COST_FROM_QUOTATION_IDX]);
      if (isNaN(c)) continue;
      sum += c * 1.0118;
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

  const totalVaPct = useMemo(() => {
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
      const v = parseNum(row[VA_PCT_FROM_COST_IDX]);
      if (isNaN(v)) continue;
      sum += v;
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

  const visibleData = useMemo(() => {
    const base = filteredData ?? data;
    if (!base || !activeRateTile) return base;
    const rows: unknown[][] = [];
    const ids: string[] = [];
    base.rows.forEach((row, i) => {
      if (!matchesRateTile(row, activeRateTile)) return;
      rows.push(row);
      ids.push(base.ids[i]);
    });
    return { ...base, rows, ids, totalRows: rows.length };
  }, [filteredData, data, activeRateTile]);

  // Per-node row counts for the flow diagram. Respects every active filter
  // except the graph's own columns (STATUS / CLEARANCE STATUS), so selecting
  // one branch never collapses the sibling counts (exclude-self cascading,
  // same convention as the sidebar aggregates).
  const graphPathColumns = useMemo(
    () => new Set(["STATUS", "CLEARANCE STATUS"]),
    [],
  );

  const graphCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const { tree } of CONTRACT_REVIEW_TREES) {
      for (const node of flatten(tree)) {
        const path = pathTo(tree, node.id);
        let n = 0;
        for (const row of allRows) {
          if (
            !matchesTableFilters(
              row,
              headers,
              columnFilters,
              multiFilters,
              globalSearch,
              dateRanges,
              undefined,
              graphPathColumns,
            ) ||
            !matchesRateTile(row, activeRateTile)
          )
            continue;
          if (!path.every((p) => matchesGraphFilter(row, p.filter))) continue;
          n++;
        }
        counts[node.id] = n;
      }
    }
    return counts;
  }, [
    allRows,
    headers,
    columnFilters,
    multiFilters,
    globalSearch,
    dateRanges,
    activeRateTile,
    graphPathColumns,
  ]);

  const handleGraphToggle = useCallback(
    (id: string) => {
      for (const { tree } of CONTRACT_REVIEW_TREES) {
        const node = flatten(tree).find((n) => n.id === id);
        if (!node) continue;
        if (activePath.includes(id)) {
          const path = pathTo(tree, id);
          for (const col of Object.keys(pathToColumnFilters(path))) {
            filterActions.onMultiFilter(col, []);
          }
          if (path.some((p) => p.filter.column === "STATUS")) {
            setStatusFilter("all");
          }
          setActivePath([]);
        } else {
          const path = pathTo(tree, id);
          const byCol = pathToColumnFilters(path);
          for (const [col, values] of Object.entries(byCol)) {
            filterActions.onMultiFilter(col, values);
          }
          if (byCol["STATUS"]) {
            setStatusFilter(
              byCol["STATUS"].includes("(Blank)")
                ? "Blanks"
                : byCol["STATUS"][0],
            );
          }
          setActivePath(path.map((p) => p.id));
        }
        return;
      }
    },
    [activePath, filterActions],
  );

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  // Display metrics for nodes flagged with a metric (e.g. Balance DI).
  // Summed over the same rows the node counts: whatever rate × (DI QTY − BILLED QTY)
  // yields, formatted with the en-IN convention used by the sidebar tiles.
  const graphValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const { tree } of CONTRACT_REVIEW_TREES) {
      for (const node of flatten(tree)) {
        if (node.metric !== "diBalance") continue;
        const path = pathTo(tree, node.id);
        let sum = 0;
        for (const row of allRows) {
          if (
            !matchesTableFilters(
              row,
              headers,
              columnFilters,
              multiFilters,
              globalSearch,
              dateRanges,
              undefined,
              graphPathColumns,
            ) ||
            !matchesRateTile(row, activeRateTile)
          )
            continue;
          if (!path.every((p) => matchesGraphFilter(row, p.filter))) continue;
          const rate = parseNum(row[RATE_IDX]);
          const di = parseNum(row[DI_QTY_IDX]);
          const billed = parseNum(row[BILLED_QTY_IDX]);
          if (isNaN(rate) || isNaN(di) || isNaN(billed)) continue;
          sum += rate * (di - billed);
        }
        values[node.id] = fmt(sum);
      }
    }
    return values;
  }, [
    allRows,
    headers,
    columnFilters,
    multiFilters,
    globalSearch,
    dateRanges,
    activeRateTile,
    graphPathColumns,
  ]);

  const fmtLakhs = (n: number) => `${(n / 100000).toFixed(1)} lakhs`;

  // Per-contract meta for the CONTRACT NO column filter dropdown
  // (party name, row count, and RATE × BAL BILL AG CONT sum). Excludes the
  // CONTRACT NO filter itself (exclude-self cascading), respects all other filters.
  const PARTY_NAME_IDX = headers.indexOf("PARTY NAME");

  const contractNoMeta = useMemo(() => {
    const meta: Record<
      string,
      { count: number; sum: number; partyName: string }
    > = {};
    for (const row of filteredData?.rows ?? []) {
      if (
        !matchesTableFilters(
          row,
          headers,
          columnFilters,
          multiFilters,
          globalSearch,
          dateRanges,
          "CONTRACT NO",
        ) ||
        !matchesRateTile(row, activeRateTile)
      )
        continue;
      const cn = String(row[CONTRACT_NO_IDX] ?? "").trim();
      if (!cn) continue;
      const e = meta[cn] ?? (meta[cn] = { count: 0, sum: 0, partyName: "" });
      e.count++;
      const rate = parseNum(row[RATE_IDX]);
      const bal = parseNum(row[BAL_BILL_AG_CONT_IDX]);
      if (!isNaN(rate) && !isNaN(bal)) e.sum += rate * bal;
      if (!e.partyName) e.partyName = String(row[PARTY_NAME_IDX] ?? "").trim();
    }
    return meta;
  }, [
    filteredData,
    headers,
    columnFilters,
    multiFilters,
    globalSearch,
    dateRanges,
    activeRateTile,
  ]);

  const columnOptionMeta = useMemo(
    () => ({
      "CONTRACT NO": Object.fromEntries(
        Object.entries(contractNoMeta).map(([cn, m]) => [
          cn,
          { count: m.count, sumLabel: fmtLakhs(m.sum), partyName: m.partyName },
        ]),
      ),
    }),
    [contractNoMeta],
  );

  const handleRateTileClick = useCallback((key: RateTileKey) => {
    setActiveRateTile((prev) => (prev === key ? null : key));
  }, []);

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
              {statusOptions.map((opt) => (
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
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXOrderQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXOrderQty"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × ORDER QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateOrderQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateOrderQty.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalBillAgCont")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalBillAgCont"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL BILL AG CONT
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalBillCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalBillCont.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("balBillAgContSum")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "balBillAgContSum"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              BAL BILL AG CONT
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(balBillAgContTotal.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {balBillAgContTotal.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("rateXMcQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXMcQty"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × MC QTY
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateMcCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateMcCont.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalDiQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalDiQty"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL DI QTY
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              (DI QTY - BILLED QTY)
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalDiQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalDiQty.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalMcQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalMcQty"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL MC QTY
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              (MC QTY - DI QTY)
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(rateBalMspQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalMspQty.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("totalCostExcGst")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalCostExcGst"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL COST (EXC GST)
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(totalCostExcGst.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalCostExcGst.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("totalCostIncGst")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalCostIncGst"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL COST (INC GST)
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(totalCostIncGst.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalCostIncGst.count} rows of {tileRowsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleRateTileClick("totalVaPct")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalVaPct"
                ? "bg-white/10 border-[#38ef7d]"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL VA %
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(totalVaPct.sum)}%
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalVaPct.count} rows of {tileRowsCount}
            </span>
          </button>
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
          <ResizablePanelGroup
            orientation="vertical"
            id="contract-review-vertical"
            defaultLayout={verticalLayout}
            onLayoutChanged={onVerticalLayoutChanged}
            className="flex-1 min-h-0 mt-4"
          >
            <ResizablePanel id="graph" defaultSize="32" minSize="12">
              <div className="h-full overflow-hidden rounded-lg border border-[#1e3d59] bg-[#0a2540]">
                <FlowDiagram
                  trees={CONTRACT_REVIEW_TREES}
                  counts={graphCounts}
                  values={graphValues}
                  activePath={activePath}
                  onToggle={handleGraphToggle}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle className="my-2 bg-[#e1e6eb]" />
            <ResizablePanel id="table" defaultSize="68" minSize="25">
              <GMDUpdateTable
                headers={headers}
                rows={visibleData?.rows ?? []}
                ids={visibleData?.ids ?? []}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                title="Contract Review"
                editable
                fullHeight
                editableColumns={[
                  "bom formula trial",
                  "Item",
                  "BOM ID",
                  "CLEARANCE STATUS",
                  "Actuator",
                  "MC Received/Pending",
                  "Inspection",
                  "Remarks",
                  "PN RATING",
                  "LC/RTGS REF NO",
                  "LC DATE/RTGS DATE",
                  "LAST DATE OF SHIPMENT/DATE OF LC",
                  "Issuing bank name",
                  "PAYMENT TERMS",
                ]}
                blankOnlyEditableColumns={["DATE OF CONTRACT"]}
                dropdownRowCondition={(header, row) => {
                  if (header !== "Actuator") return true;
                  const n = String(row[ITEM_NAME_IDX] ?? "")
                    .toLowerCase()
                    .replace(/\s+/g, "");
                  return (
                    n.includes("actuator") ||
                    n.includes("_act") ||
                    n.includes("act+gb")
                  );
                }}
                categoryOptions={categoryOptions}
                fixedDropdownOptions={{
                  "MC Received/Pending": ["Received", "Pending"],
                  Inspection: ["DONE", "PENDING"],
                  Actuator: actuatorOptions,
                  "PAYMENT TERMS": [
                    "CREDIT 45",
                    "CREDIT 30",
                    "CREDIT 90",
                    "CREDIT LC-30",
                    "100% ADVANCE",
                    "CREDIT LC-60",
                    "CREDIT LC-90",
                    "CREDIT 15",
                    "CREDIT LC-45",
                    "Credit 21",
                    "PDC 45",
                    "Credit 7",
                    "CREDIT 60",
                    "10 ADV, BAL DELIVERY",
                    "20 ADV, BAL DELIVERY",
                    "20 ADV, BAL BEFORE DELIVERY",
                    "15 ADV, BAL BEFORE DELIVERY",
                    "25 ADV, BAL BEFORE DELIVERY",
                    "NA",
                    "20 ADV, BAL 30 DAYS DELIVERY",
                    "CREDIT LC-150",
                    "AFTER GRN",
                    "5 ADV, BAL LC 30",
                  ],
                }}
                onCellUpdate={handleCellUpdate}
                externalFiltersActive={
                  hasTileFilter ||
                  balBillFilter !== "all" ||
                  statusFilter !== "all" ||
                  clearanceFilter.length > 0
                }
                filterState={filterState}
                filterActions={filterActions}
                columnOptionMeta={columnOptionMeta}
                bomIdOptionsById={bomIdOptionsById}
                onSelectBomId={handleSelectBomId}
                bomIdCategoryFilter
                onReset={() => {
                  setTileItem("");
                  setTileSize("");
                  setTilePn("");
                  setActiveRateTile(null);
                  setBalBillFilter("all");
                  setStatusFilter("all");
                  setActivePath([]);
                  filterActions.onMultiFilter("CLEARANCE STATUS", []);
                  filterActions.onMultiFilter("STATUS", []);
                }}
                hiddenColumns={[
                  "VA %",
                  "CV",
                  "COST FROM QUOTATION",
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
                  "BILLED QTY",
                  "DI QTY",
                  "MC QTY",
                  "OFFER NUMBER",
                  "INSPECTION NUMBER",
                  "DI DATE",
                  "STATUS"
                ]}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </main>
  );
}
