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

export default function ContractReviewPage() {
  const [data, setData] = useState<ContractReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [balBillFilter, setBalBillFilter] = useState<BalBillFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");

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

  const filteredData = useMemo(() => {
    if (
      !data ||
      (balBillFilter === "all" && statusFilter === "all") ||
      balBillIdx === -1
    ) {
      return data;
    }
    const rows: unknown[][] = [];
    const filteredIds: string[] = [];
    data.rows.forEach((row, i) => {
      const isYes = isZeroBal(row[balBillIdx]);
      const balMatch =
        balBillFilter === "all" ||
        (balBillFilter === "yes" ? isYes : !isYes);
      const statusMatch = statusFilter === "Completed" ? isYes : true;
      if (balMatch && statusMatch) {
        rows.push(row);
        filteredIds.push(data.ids[i]);
      }
    });
    return { ...data, rows, ids: filteredIds, totalRows: rows.length };
  }, [data, balBillFilter, statusFilter, balBillIdx]);

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
        <aside className="w-56 shrink-0 h-fit bg-[#0a2540] border border-[#1e3d59] rounded-lg shadow-sm p-4 flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            Filters
          </span>
          {/* <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[#0a2540]/60">
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
              <option value="all">All</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
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
          {error && (
            <div className="mt-2 text-sm text-red-600">{error}</div>
          )}
          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1 mt-4">
            <GMDUpdateTable
              headers={headers}
              rows={filteredData?.rows ?? []}
              ids={filteredData?.ids ?? []}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title="Contract Review"
              editableColumns={["BOM FORMULA TRAIL", ""]}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
