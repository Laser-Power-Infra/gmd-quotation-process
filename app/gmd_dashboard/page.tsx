"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";

interface SheetData {
  headers: string[];
  rows: unknown[][];
  syncedAt: string | null;
}

const NEW_STATUS_COL = "NEW ITEM STATUS";

export default function Home() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/gmd_dashboard/api/gmd-update");
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
      const res = await fetch("/gmd_dashboard/api/gmd-update/sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const allRows = data?.rows ?? [];
  const newStatusIdx = headers.indexOf(NEW_STATUS_COL);

  const newRows = useMemo(
    () =>
      newStatusIdx === -1
        ? allRows
        : allRows.filter((row) => {
            const val = String(row[newStatusIdx] ?? "").trim();
            return val === "" || val === "-";
          }),
    [allRows, newStatusIdx],
  );

  const processedRows = useMemo(
    () =>
      newStatusIdx === -1
        ? []
        : allRows.filter((row) => {
            const val = String(row[newStatusIdx] ?? "").trim();
            return val !== "" && val !== "-";
          }),
    [allRows, newStatusIdx],
  );

  const totalRows = allRows.length;
  const syncedAt = data?.syncedAt ?? null;

  if (loading) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader totalRows={0} syncedAt={null} onSync={handleSync} syncing={false} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="h-screen flex flex-col bg-background">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader totalRows={0} syncedAt={null} onSync={handleSync} syncing={false} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-background">
      <div className="flex-1 flex flex-col p-6 min-h-0">
        <GMDUpdateHeader totalRows={totalRows} syncedAt={syncedAt} onSync={handleSync} syncing={syncing} />

        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1">
          <GMDUpdateTable
            headers={headers}
            rows={newRows}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="New Items (Blank Status)"
            hiddenFilters={["NEW ITEM STATUS"]}
          />
          <GMDUpdateTable
            headers={headers}
            rows={processedRows}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="Processed Items"
            editable
          />
        </div>
      </div>
    </main>
  );
}