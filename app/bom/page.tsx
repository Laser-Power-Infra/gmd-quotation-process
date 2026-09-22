"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Database, Loader2 } from "lucide-react";
import { RefreshCw } from "lucide-react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import {
  updateVerifyBomFieldBatchAction,
  syncNullVerifyBomStockAction,
  deriveVerifyBomItemNameBatchAction,
  recomputeVerifyBomBomQtyCostBatchAction,
} from "@/app/actions";
import { VERIFY_BOM_HEADER_TO_DB_FIELD } from "@/lib/gmd_lib/verify-bom-columns";

const TABLE2_EDITABLE_COLUMNS = [
  "BOM ID TYPE",
  "BOM ITEM QTY",
  "ITEM SCHEDULE NAME",
  "ITEM TYPE",
  "MOC",
  "OPERATION",
  "SIZE",
  "NO",
  "PN-GMD",
  "CURRENT REQT",
  "NEW ITEM NAME",
  "DUPLICATE MERGER COUNT",
  "BOM NATURE",
  "CONSUMPTION-1",
  "CONSUMPTION 2",
  "CONSUMPTION 3",
];

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
  const [selectedNoIndex, setSelectedNoIndex] = useState<number | null>(null);

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

  const autoItemNameRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const itemTypeIdx = headers.indexOf("ITEM TYPE");
    const mocIdx = headers.indexOf("MOC");
    const operationIdx = headers.indexOf("OPERATION");
    const sizeIdx = headers.indexOf("SIZE");
    const pnGmdIdx = headers.indexOf("PN-GMD");
    const newItemNameIdx = headers.indexOf("NEW ITEM NAME");
    if (
      [itemTypeIdx, mocIdx, operationIdx, sizeIdx, pnGmdIdx, newItemNameIdx].some(
        (i) => i < 0,
      )
    ) {
      return;
    }
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoItemNameRef.current.has(id)) return;
      const parts = [row[itemTypeIdx], row[mocIdx], row[operationIdx], row[sizeIdx], row[pnGmdIdx]].map(
        (v) => String(v ?? "").trim(),
      );
      const derived = parts.some((p) => p === "") ? "" : parts.join("_");
      const current = String(row[newItemNameIdx] ?? "").trim();
      if (current === derived) return;
      autoItemNameRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    deriveVerifyBomItemNameBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map((res.data ?? []).map((d) => [d.id, d.merged ?? ""]));
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined) return row;
            const next = [...row];
            next[newItemNameIdx] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const autoBomQtyCostRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const bomItemQtyIdx = headers.indexOf("BOM ITEM QTY");
    const costIdx = headers.indexOf("COST");
    const bomItemQtyCostIdx = headers.indexOf("BOM ITEM QTY * COST");
    if ([bomItemQtyIdx, costIdx, bomItemQtyCostIdx].some((i) => i < 0)) {
      return;
    }
    const parseNum = (v: unknown): number | null => {
      const s = String(v ?? "").replace(/,/g, "").trim();
      if (!s || s === "-") return null;
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };
    const compute = (row: unknown[]): string => {
      const qty = parseNum(row[bomItemQtyIdx]);
      const cost = parseNum(row[costIdx]);
      if (qty === null) return "";
      if (cost === null) return "RM COST NOT AVAILABLE";
      return (Math.round(qty * cost * 100) / 100).toString();
    };
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoBomQtyCostRef.current.has(id)) return;
      const current = String(row[bomItemQtyCostIdx] ?? "").trim();
      if (current === compute(row)) return;
      autoBomQtyCostRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    recomputeVerifyBomBomQtyCostBatchAction(pending).then((res) => {
      if (!res?.success) return;
      setData((prev) => {
        if (!prev) return prev;
        const map = new Map(
          (res.data ?? []).map((d) => [d.id, d.bomItemQtyCost ?? ""]),
        );
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            const v = map.get(prev.ids[i]);
            if (v === undefined) return row;
            const next = [...row];
            next[bomItemQtyCostIdx] = v;
            return next;
          }),
        };
      });
    });
  }, [data, headers]);

  const { yesRows, yesIds, noRows, noIds } = useMemo(() => {
    const yesRows: unknown[][] = [];
    const yesIds: string[] = [];
    const noRows: unknown[][] = [];
    const noIds: string[] = [];
    const rows = data?.rows ?? [];
    const currentReqtIdx = headers.indexOf("CURRENT REQT");
    rows.forEach((row, i) => {
      const v =
        currentReqtIdx >= 0
          ? String(row[currentReqtIdx] ?? "").trim().toLowerCase()
          : "";
      if (v === "yes") {
        yesRows.push(row);
        yesIds.push(ids[i]);
      } else {
        noRows.push(row);
        noIds.push(ids[i]);
      }
    });
    return { yesRows, yesIds, noRows, noIds };
  }, [data, headers, ids]);

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
            <>
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
            </>
          }
        />
        {error && (
          <div className="mt-2 text-sm text-red-600">{error}</div>
        )}
        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1 mt-4">
          <GMDUpdateTable
            headers={headers}
            rows={yesRows}
            ids={yesIds}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="Verify BOM — YES"
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
          <GMDUpdateTable
            headers={headers}
            rows={noRows}
            ids={noIds}
            selectedIndex={selectedNoIndex}
            onSelect={setSelectedNoIndex}
            title="Verify BOM — NO/Blank"
            groupByColumn="BOM ID"
            mergeColumns={["BOM ID", "ITEM CODE", "BOM ID TYPE", "USE/NO USE", "AVAILABLE STOCK"]}
            mergeTypeColumn="BOM ID TYPE"
            mergeOnlyTypes={["2:1", "3:1"]}
            editable
            editableColumns={TABLE2_EDITABLE_COLUMNS}
            fixedDropdownOptions={{ "BOM ID TYPE": ["2:1", "3:1", "DIRECT M2M", "CREATE BOM"] }}
            onCellUpdate={handleCellUpdate}
            hiddenColumns={["ITEM SCHEDULE NAME"]}
          />
        </div>
      </div>
    </main>
  );
}
