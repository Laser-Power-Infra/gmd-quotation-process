"use client";

import { useState, useEffect, useCallback } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import { updateVerifyBomFieldBatchAction } from "@/app/actions";
import { VERIFY_BOM_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/verify-bom-columns";

interface BomData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
}

export default function BomPage() {
  const [data, setData] = useState<BomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bom");
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
      const res = await fetch("/api/bom/sync", { method: "POST" });
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

  const handleRecompute = useCallback(async () => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/recompute", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Recompute failed");
      }
      await fetchData();
      toast.success(`Recomputed ${body.verifyUpdated ?? 0} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recompute failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setRecomputing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const headers = data?.headers ?? [];
  const ids = data?.ids ?? [];

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      if (!data) return;
      const header = headers[colIndex];
      if (!header) return;
      const field = VERIFY_BOM_HEADER_TO_DB_FIELD[header];
      if (!field) return;

      const bomIdIdx = headers.indexOf("BOM ID");
      const rowIdx = data.ids.indexOf(id);
      const bomId =
        rowIdx !== -1 ? String(data.rows[rowIdx][bomIdIdx] ?? "").trim() : "";

      let groupIds = [id];
      if (field === "bomIdType" && bomId) {
        groupIds = data.rows
          .map((r, i) => ({
            id: data.ids[i],
            bom: String(r[bomIdIdx] ?? "").trim(),
          }))
          .filter((x) => x.bom === bomId)
          .map((x) => x.id);
      }

      const res = await updateVerifyBomFieldBatchAction(
        groupIds,
        field,
        value || null,
      );
      if (res?.success) {
        const idSet = new Set(groupIds);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((row, i) =>
              idSet.has(prev.ids[i])
                ? (() => {
                    const next = [...row];
                    next[colIndex] = value;
                    return next;
                  })()
                : row,
            ),
          };
        });
        toast.success(`Updated ${groupIds.length} row(s)`);
      } else {
        toast.error(res?.error || "Failed to update");
      }
    },
    [data, headers],
  );

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="VERIFY BOM" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="VERIFY BOM" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex flex-col p-6 min-h-0">
        <GMDUpdateHeader
          title="VERIFY BOM"
          totalRows={data?.totalRows ?? 0}
          syncedAt={data?.syncedAt ?? undefined}
          onSync={handleSync}
          syncing={syncing}
          onRecompute={handleRecompute}
          recomputing={recomputing}
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
            title="Verify BOM"
            groupByColumn="BOM ID"
            mergeColumns={["BOM ID", "ITEM CODE", "BOM ID TYPE", "USE/NO USE", "AVAILABLE STOCK"]}
            mergeTypeColumn="BOM ID TYPE"
            mergeOnlyTypes={["2:1", "3:1"]}
            editable
            editableColumns={["BOM ID TYPE"]}
            fixedDropdownOptions={{ "BOM ID TYPE": ["2:1", "3:1", "DIRECT M2M", "CREATE BOM"] }}
            onCellUpdate={handleCellUpdate}
          />
        </div>
      </div>
    </main>
  );
}
