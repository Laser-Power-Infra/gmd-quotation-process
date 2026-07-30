"use client";

import { useState, useEffect, useCallback } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import { updateSupplyHistoryFieldAction } from "@/app/actions";
import { SUPPLY_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/supply-history-columns";

interface SupplyHistoryData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

export default function SupplyHistoryPage() {
  const [data, setData] = useState<SupplyHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/supply-history/sync", { method: "POST" });
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

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = data?.headers[colIndex];
      if (!header) return;
      const field = SUPPLY_HEADER_TO_DB_FIELD[header];
      if (!field) return;

      toast.promise(
        updateSupplyHistoryFieldAction(id, field, value || null),
        {
          loading: `Updating ${header}...`,
          success: `${header} updated`,
          error: (err) => err || `Failed to update ${header}`,
        },
      );
    },
    [data?.headers],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.ids ?? [];

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

  if (error && !data) {
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
        <GMDUpdateHeader
          title="SUPPLY HISTORY"
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
            rows={data?.rows ?? []}
            ids={ids}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title={`Supply History`}
            editable
            editableColumns={["Party Mail Address"]}
            onCellUpdate={handleCellUpdate}
          />
        </div>
      </div>
    </main>
  );
}
