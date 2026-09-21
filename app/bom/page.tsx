"use client";

import { useState, useEffect, useCallback } from "react";
import { Database, Loader2 } from "lucide-react";
import { RefreshCw, Loader2 } from "lucide-react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  updateVerifyBomFieldBatchAction,
  syncNullVerifyBomStockAction,
} from "@/app/actions";
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
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [syncingStock, setSyncingStock] = useState(false);
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

  const handleSyncMissingStock = useCallback(async () => {
    setSyncingStock(true);
    const toastId = toast.loading("Checking Google Sheets for missing available stock...");
    try {
      const res = await syncNullVerifyBomStockAction();
      if (!res?.success) {
        toast.error(res?.error || "Failed to sync available stock", { id: toastId });
        return;
      }
      if (res.updatedCount === 0) {
        toast.info(
          `Checked ${res.totalNullCount} null items: no matching stock found in Google Sheets.`,
          { id: toastId },
        );
      } else {
        toast.success(
          `Successfully populated available stock for ${res.updatedCount} items!`,
          { id: toastId },
        );
        await fetchData();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to sync available stock", { id: toastId });
    } finally {
      setSyncingStock(false);
    }
  }, [fetchData]);

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

  const handleMetaSync = useCallback(async () => {
    setSyncingMeta(true);
    setError(null);
    try {
      const res = await fetch("/api/bom/sync-meta", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sync Item Meta failed (${res.status})`);
      }
      const json = await res.json();
      toast.success(`Item meta synced: ${json.count ?? 0} row(s) updated`);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync Item Meta failed");
    } finally {
      setSyncingMeta(false);
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

      const toastId = toast.loading("Updating...");
      try {
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
          toast.success(`Updated ${groupIds.length} row(s)`, { id: toastId });
        } else {
          toast.error(res?.error || "Failed to update", { id: toastId });
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to update", { id: toastId });
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
          actions={
            <button
              onClick={handleMetaSync}
              disabled={syncingMeta}
              className="flex items-center gap-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 rounded px-3 py-1.5 text-[11px] font-semibold text-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncingMeta ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Database size={12} />
              )}
              {syncingMeta ? "Syncing..." : "Sync Item Meta"}
            </button>
          }
          actions={
            <button
              type="button"
              onClick={handleSyncMissingStock}
              disabled={syncingStock || loading}
              className="flex items-center gap-1.5 bg-[#38ef7d]/10 hover:bg-[#38ef7d]/20 border border-[#38ef7d]/40 rounded px-3 py-1.5 text-[11px] font-semibold text-[#38ef7d] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="Find null available stock in VerifyBom, match with Google Sheet, and backfill available stock"
            >
              {syncingStock ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {syncingStock ? "Syncing Stock..." : "Sync Missing Stock"}
            </button>
          }
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
            hiddenColumns={["ITEM SCHEDULE NAME"]}
          />
        </div>
      </div>
    </main>
  );
}
