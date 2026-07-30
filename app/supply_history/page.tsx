"use client";

import { useState, useEffect, useCallback } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";

interface SupplyHistoryData {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
}

export default function SupplyHistoryPage() {
  const [data, setData] = useState<SupplyHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/supply-history");
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.rows.map((_, i) => `row-${i}`) ?? [];

  if (loading) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-background">
      <div className="flex-1 flex flex-col p-6 min-h-0">
        <GMDUpdateHeader title="SUPPLY HISTORY" totalRows={data?.totalRows ?? 0} />
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1">
          <GMDUpdateTable
            headers={headers}
            rows={data?.rows ?? []}
            ids={ids}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title={`Supply History`}
          />
        </div>
      </div>
    </main>
  );
}
