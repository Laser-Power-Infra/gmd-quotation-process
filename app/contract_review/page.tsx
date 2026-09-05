"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";

interface ContractReviewData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

type BalBillFilter = "all" | "yes" | "no";

function isZeroBal(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  const n = parseFloat(s.replace(/,/g, ""));
  return !isNaN(n) && n === 0;
}

const ITEM_IDX = 15;
const SIZE_IDX = 17;
const PN_IDX = 18;
const RATE_IDX = 5;
const MC_QTY_IDX = 9;

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

function matchesTiles(
  row: unknown[],
  item: string,
  size: string,
  pn: string,
): boolean {
  return (
    (!item || String(row[ITEM_IDX] ?? "").trim() === item) &&
    (!size || String(row[SIZE_IDX] ?? "").trim() === size) &&
    (!pn || String(row[PN_IDX] ?? "").trim() === pn)
  );
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

  const balBillCounts = useMemo(() => {
    if (!data || balBillIdx === -1) return { all: 0, yes: 0, no: 0 };
    let yes = 0;
    for (const row of data.rows) {
      if (isZeroBal(row[balBillIdx])) yes++;
    }
    return { all: data.rows.length, yes, no: data.rows.length - yes };
  }, [data, balBillIdx]);

  const allRows = data?.rows ?? [];

  const itemOptions = useMemo(
    () =>
      groupCount(allRows, ITEM_IDX, (row) =>
        matchesTiles(row, "", tileSize, tilePn),
      ),
    [allRows, tileSize, tilePn],
  );

  const sizeOptions = useMemo(
    () =>
      groupCount(allRows, SIZE_IDX, (row) =>
        matchesTiles(row, tileItem, "", tilePn),
      ),
    [allRows, tileItem, tilePn],
  );

  const pnOptions = useMemo(
    () =>
      groupCount(allRows, PN_IDX, (row) =>
        matchesTiles(row, tileItem, tileSize, ""),
      ),
    [allRows, tileItem, tileSize],
  );

  const rateMcCont = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const row of allRows) {
      if (!matchesTiles(row, tileItem, tileSize, tilePn)) continue;
      const rate = parseFloat(String(row[RATE_IDX] ?? "").replace(/,/g, ""));
      const qty = parseFloat(String(row[MC_QTY_IDX] ?? "").replace(/,/g, ""));
      if (isNaN(rate) || isNaN(qty)) continue;
      sum += rate * qty;
      count++;
    }
    return { sum, count };
  }, [allRows, tileItem, tileSize, tilePn]);

  const tileRowsCount = useMemo(
    () =>
      allRows.reduce(
        (n, row) => n + (matchesTiles(row, tileItem, tileSize, tilePn) ? 1 : 0),
        0,
      ),
    [allRows, tileItem, tileSize, tilePn],
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
      const balMatch =
        balBillIdx === -1 ||
        balBillFilter === "all" ||
        (balBillFilter === "yes"
          ? isZeroBal(row[balBillIdx])
          : !isZeroBal(row[balBillIdx]));
      const statusMatch =
        statusFilter === "Completed" ? isZeroBal(row[balBillIdx]) : true;
      const tileMatch = matchesTiles(row, tileItem, tileSize, tilePn);
      if (balMatch && statusMatch && tileMatch) {
        rows.push(row);
        filteredIds.push(data.ids[i]);
      }
    });
    return { ...data, rows, ids: filteredIds, totalRows: rows.length };
  }, [
    data,
    hasTileFilter,
    balBillFilter,
    statusFilter,
    balBillIdx,
    tileItem,
    tileSize,
    tilePn,
  ]);

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const tileAllCounts = useMemo(
    () => ({
      item: allRows.reduce(
        (n, r) => n + (matchesTiles(r, "", tileSize, tilePn) ? 1 : 0),
        0,
      ),
      size: allRows.reduce(
        (n, r) => n + (matchesTiles(r, tileItem, "", tilePn) ? 1 : 0),
        0,
      ),
      pn: allRows.reduce(
        (n, r) => n + (matchesTiles(r, tileItem, tileSize, "") ? 1 : 0),
        0,
      ),
    }),
    [allRows, tileItem, tileSize, tilePn],
  );

  if (loading) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-background">
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
          {/* <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              STATUS
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs border border-[#e1e6eb] rounded bg-white text-[#0a2540] px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div> */}
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
              editableColumns={["bom formula trial"]}
              externalFiltersActive={
                hasTileFilter || balBillFilter !== "all" || statusFilter !== "all"
              }
              onReset={() => {
                setTileItem("");
                setTileSize("");
                setTilePn("");
                setBalBillFilter("all");
                setStatusFilter("all");
              }}
              hiddenColumns={["BAL BILL AG MC", "JOB Code"]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
