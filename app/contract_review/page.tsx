"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  selectContractReviewBomIdAction,
  updateContractReviewFieldAction,
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
}

type BalBillFilter = "all" | "yes" | "no";

function isZeroBal(value: unknown): boolean {
  let s = String(value ?? "").trim();
  if (!s) return false;
  s = s.replace(/^["']+|["']+$/g, "").trim();
  const n = parseFloat(s.replace(/,/g, ""));
  return !isNaN(n) && n === 0;
}

const ITEM_IDX = CONTRACT_REVIEW_HEADERS.indexOf("Item");
const SIZE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("SIZE");
const PN_IDX = CONTRACT_REVIEW_HEADERS.indexOf("PN RATING");
const RATE_IDX = CONTRACT_REVIEW_HEADERS.indexOf("RATE");
const MC_QTY_IDX = CONTRACT_REVIEW_HEADERS.indexOf("MC QTY");
const BOM_ID_IDX = CONTRACT_REVIEW_HEADERS.indexOf("BOM ID");

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
  item: string,
  size: string,
  pn: string,
  balBillIdx: number,
  clearanceIdx: number,
  exclude?: "balBill" | "status" | "item" | "size" | "pn",
): boolean {
  if (exclude !== "balBill" && balBill !== "all") {
    const isYes = isZeroBal(row[balBillIdx]);
    const ok = balBill === "yes" ? isYes : !isYes;
    if (!ok) return false;
  }
  if (exclude !== "status" && status !== "all") {
    if (status === "Completed") {
      if (!isZeroBal(row[balBillIdx])) return false;
    } else {
      const cell = String(row[clearanceIdx] ?? "").trim();
      const ok = status === "Blanks" ? cell === "" : cell === status;
      if (!ok) return false;
    }
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

function matchesTableFilters(
  row: unknown[],
  headers: string[],
  columnFilters: Record<string, string>,
  multiFilters: Record<string, string[]>,
  globalSearch: string,
): boolean {
  if (globalSearch.trim()) {
    const q = globalSearch.toLowerCase();
    const hay = headers
      .map((_, i) => String(row[i] ?? "").toLowerCase())
      .join(" ");
    if (!hay.includes(q)) return false;
  }
  for (const [colName, filterVal] of Object.entries(columnFilters)) {
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
    if (!selected.length) continue;
    const colIdx = headers.indexOf(colName);
    if (colIdx === -1) continue;
    const cellVal = String(row[colIdx] ?? "").trim();
    const matchesBlank = selected.includes("(Blank)") && cellVal === "";
    if (!(matchesBlank || selected.includes(cellVal))) return false;
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
  const [tileItem, setTileItem] = useState("");
  const [tileSize, setTileSize] = useState("");
  const [tilePn, setTilePn] = useState("");
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
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

  const STATUS_OPTIONS = [
    "Blanks",
    "Closed",
    "Completed",
    "Duplicate",
    "Hold",
    "Shortclosed",
    "To be closed",
  ] as const;

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

  const headers = data?.headers ?? [];
  const balBillIdx = data ? headers.indexOf("BAL BILL AG CONT") : -1;
  const clearanceIdx = data ? headers.indexOf("CLEARANCE STATUS") : -1;

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

  const categoryOptions = useMemo<Record<string, string[]>>(() => {
    if (!data) return {};
    const items = [
      ...new Set(
        data.rows.map((r) => String(r[ITEM_IDX] ?? "").trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const result: Record<string, string[]> = {};
    if (items.length) result.Item = items;
    return result;
  }, [data]);

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
        ),
      ),
    [allRows, headers, columnFilters, multiFilters, globalSearch],
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
      const cell = String(row[clearanceIdx] ?? "").trim();
      const key = cell === "" ? "Blanks" : cell;
      if (key in counts) counts[key]++;
    }
    return counts;
  }, [
    sidebarBaseRows,
    balBillFilter,
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  const itemOptions = useMemo(
    () =>
      groupCount(sidebarBaseRows, ITEM_IDX, (row) =>
        matchesSidebar(
          row,
          balBillFilter,
          statusFilter,
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
    tileItem,
    tileSize,
    tilePn,
    balBillIdx,
    clearanceIdx,
  ]);

  const tileRowsCount = useMemo(
    () =>
      sidebarBaseRows.reduce(
        (n, row) =>
          n +
          (matchesSidebar(
            row,
            balBillFilter,
            statusFilter,
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
      (!hasTileFilter && balBillFilter === "all" && statusFilter === "all")
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
        <aside className="w-64 shrink-0 h-fit bg-[#0a2540] border border-[#1e3d59] rounded-lg shadow-sm p-4 flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            Filters
          </span>
          <div className="flex flex-col gap-1.5">
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
          </div>
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
              editableColumns={["bom formula trial", "Item"]}
              categoryOptions={categoryOptions}
              onCellUpdate={handleCellUpdate}
              externalFiltersActive={
                hasTileFilter ||
                balBillFilter !== "all" ||
                statusFilter !== "all"
              }
              filterState={filterState}
              filterActions={filterActions}
              bomIdOptionsById={bomIdOptionsById}
              onSelectBomId={handleSelectBomId}
              onReset={() => {
                setTileItem("");
                setTileSize("");
                setTilePn("");
                setBalBillFilter("all");
                setStatusFilter("all");
              }}
              hiddenColumns={[
                "VA %",
                "CV",
                "FREE STOCK",
                "FINAL REQ",
                "MC QTY",
                "Balance mc",
                "PROD ORD QTY",
                "BALANCE TO PROD ORD",
                "BALANCE TO PROD ENT",
                "DI QTY",
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
              ]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
