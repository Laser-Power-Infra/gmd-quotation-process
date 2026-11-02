"use client";

import { useCallback, useEffect, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import GMDUpdateTable from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";

interface ErpBomData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

// One BOM per group: the BOM header cells render once, its components below.
const MERGE_COLUMNS = ["BOM_ID", "ITEM_CODE", "ITEM NAME", "BOM_DATE"];

/** ERP BOM tab of FG BOM: BOM MAST ERP as the ERP holds it (read-only). */
export default function ErpBomTab() {
  const [data, setData] = useState<ErpBomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/erp");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex-1 flex flex-col p-6 min-h-0 min-w-0">
      <GMDUpdateHeader
        title="ERP BOM"
        totalRows={data?.totalRows ?? 0}
        syncedAt={data?.syncedAt ?? undefined}
        onSync={fetchData}
        syncing={loading}
      />
      {loading && !data ? (
        <GMDUpdateSkeleton />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 min-w-0 flex flex-col gap-4 pr-1 mt-4">
          {error && <div className="text-sm text-red-600 dark:text-red-300">{error}</div>}
          <GMDUpdateTable
            headers={data?.headers ?? []}
            rows={data?.rows ?? []}
            ids={data?.ids ?? []}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="ERP BOM — BOM MAST ERP"
            groupByColumn="BOM_ID"
            mergeColumns={MERGE_COLUMNS}
            fullHeight
          />
        </div>
      )}
    </div>
  );
}
