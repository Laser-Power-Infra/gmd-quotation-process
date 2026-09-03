"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import GMDUpdateHeader from "../../components/gmd_dashboard/GMDUpdateHeader";
import GMDUpdateTable from "../../components/gmd_dashboard/GMDUpdateTable";
import ErrorState from "../../components/gmd_dashboard/ErrorState";
import GMDUpdateSkeleton from "../../components/gmd_dashboard/skeletons/GMDUpdateSkeleton";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  hydrateGMDUpdate,
  selectAllGMDUpdateRows,
  type GMDUpdateRow,
} from "@/lib/gmdUpdateSlice";
import { dbItemToRow } from "@/lib/gmd_lib/mapSheetRow";
import { FIXED_DROPDOWN_OPTIONS } from "@/lib/gmd_lib/sheet-columns";
import { getUsdInrRateAction } from "@/app/actions";

interface SheetData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  syncedAt: string | null;
}

const NEW_STATUS_COL = "NEW ITEM STATUS";

function rowToGMDUpdateItem(id: string, row: unknown[]): GMDUpdateRow {
  return {
    id,
    erpItemCode:    String(row[0] ?? ""),
    itemNameAuto:   String(row[1] ?? ""),
    l1:             String(row[2] ?? ""),
    l2ValveType:    String(row[3] ?? ""),
    l3Dia:          String(row[4] ?? ""),
    l7Dimension:    String(row[5] ?? ""),
    l4Component:    String(row[6] ?? ""),
    l5Material:     String(row[7] ?? ""),
    l6Std:          String(row[8] ?? ""),
    l8ItemCategory: String(row[9] ?? ""),
    um:             String(row[10] ?? ""),
    availableStock: String(row[11] ?? ""),
    conv1:          String(row[12] ?? ""),
    pcsWgt:         String(row[13] ?? ""),
    aum:            String(row[14] ?? ""),
    cost:           String(row[15] ?? ""),
    usdRateOption:  String(row[16] ?? ""),
    hsnCode:        String(row[17] ?? ""),
    hsnCodeValidation: String(row[18] ?? ""),
    conv2:          String(row[19] ?? ""),
    majorMarking:   String(row[20] ?? ""),
    newItemStatus:  String(row[21] ?? ""),
    currentStatus:  String(row[22] ?? ""),
    rmType:         String(row[23] ?? ""),
    indianImported: String(row[24] ?? ""),
  };
}

export default function Home() {
  const dispatch = useAppDispatch();
  const allItems = useAppSelector(selectAllGMDUpdateRows);
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<Record<string, string[]>>({});
  const [usdInrRate, setUsdInrRate] = useState<number | null>(null);

  const refreshRate = useCallback(async () => {
    const res = await getUsdInrRateAction(true);
    if (res.success && res.data) setUsdInrRate(res.data.rate);
  }, []);

  useEffect(() => {
    getUsdInrRateAction(false).then((res) => {
      if (res.success && res.data) setUsdInrRate(res.data.rate);
    });
  }, []);

  const enhancedCategoryOptions = useMemo(
    () => ({
      ...categoryOptions,
      "INDIAN/IMPORTED": categoryOptions["INDIAN/IMPORTED"] || ["Indian", "Imported"],
    }),
    [categoryOptions],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/raw_material/api/gmd-update");
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
      const res = await fetch("/raw_material/api/gmd-update/sync", { method: "POST" });
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

  useEffect(() => {
    fetch("/raw_material/api/gmd-category")
      .then((res) => res.json())
      .then(setCategoryOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (data?.ids && data?.rows) {
      const validIndices = data.rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => String(row[0] ?? "").trim() !== "")
        .map(({ i }) => i);
      const items = validIndices.map((i) =>
        rowToGMDUpdateItem(data.ids[i], data.rows[i]),
      );
      dispatch(hydrateGMDUpdate(items));
    }
  }, [data, dispatch]);

  const headers = data?.headers ?? [];
  const syncedAt = data?.syncedAt ?? null;

  const newItems = useMemo(
    () =>
      allItems.filter(
        (item) => !item.newItemStatus || item.newItemStatus === "-" || item.newItemStatus === "Updated",
      ),
    [allItems],
  );

  const processedItems = useMemo(
    () =>
      allItems.filter(
        (item) => item.newItemStatus && item.newItemStatus !== "-" && item.newItemStatus !== "Updated",
      ),
    [allItems],
  );

  const totalRows = allItems.length;

  const processedItemRows = useMemo(
    () => processedItems.map(dbItemToRow),
    [processedItems],
  );
  const processedItemIds = useMemo(
    () => processedItems.map((i) => i.id),
    [processedItems],
  );

  const [firstFilteredRows, setFirstFilteredRows] = useState<unknown[][]>([]);
  const [scope, setScope] = useState<"all" | "indian" | "imported">("all");

  const scopedNewItems = useMemo(() => {
    if (scope === "all") return newItems;
    const target = scope;
    return newItems.filter((item) =>
      (item.indianImported ?? "").trim().toLowerCase() === target,
    );
  }, [newItems, scope]);

  const scopedNewItemRows = useMemo(
    () => scopedNewItems.map(dbItemToRow),
    [scopedNewItems],
  );
  const scopedNewItemIds = useMemo(
    () => scopedNewItems.map((i) => i.id),
    [scopedNewItems],
  );

  const cardStats = useMemo(() => {
    const baseRows = firstFilteredRows.length
      ? firstFilteredRows
      : newItems.map(dbItemToRow);

    const empty = { count: 0, sum: 0 };
    const stats = {
      indian: { ...empty },
      imported: { ...empty },
      major: { ...empty },
      minor: { ...empty },
      indianMajor: { ...empty },
      indianMinor: { ...empty },
      importedMajor: { ...empty },
      importedMinor: { ...empty },
    };

    for (const row of baseRows) {
      const stockStr = String(row[11] ?? "").trim();
      const costStr = String(row[15] ?? "").trim();
      if (stockStr === "" || costStr === "") continue;
      const stock = parseFloat(stockStr.replace(/,/g, ""));
      const cost = parseFloat(costStr.replace(/,/g, ""));
      if (isNaN(stock) || isNaN(cost)) continue;
      const value = stock * cost;

      const imp = String(row[24] ?? "").trim().toLowerCase();
      const isIndian = imp === "indian";
      const isImported = imp === "imported";
      const isMajor = String(row[20] ?? "") === "true";
      const isMinor = String(row[20] ?? "") === "false";

      if (isIndian) {
        stats.indian.count++;
        stats.indian.sum += value;
      }
      if (isImported) {
        stats.imported.count++;
        stats.imported.sum += value;
      }
      if (isMajor) {
        stats.major.count++;
        stats.major.sum += value;
      }
      if (isMinor) {
        stats.minor.count++;
        stats.minor.sum += value;
      }
      if (isIndian && isMajor) {
        stats.indianMajor.count++;
        stats.indianMajor.sum += value;
      }
      if (isIndian && isMinor) {
        stats.indianMinor.count++;
        stats.indianMinor.sum += value;
      }
      if (isImported && isMajor) {
        stats.importedMajor.count++;
        stats.importedMajor.sum += value;
      }
      if (isImported && isMinor) {
        stats.importedMinor.count++;
        stats.importedMinor.sum += value;
      }
    }

    return stats;
  }, [firstFilteredRows, newItems]);

  const majorStat =
    scope === "indian"
      ? cardStats.indianMajor
      : scope === "imported"
        ? cardStats.importedMajor
        : cardStats.major;
  const minorStat =
    scope === "indian"
      ? cardStats.indianMinor
      : scope === "imported"
        ? cardStats.importedMinor
        : cardStats.minor;

  const fmt = (n: number) =>
    n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

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
      <div className="flex-1 flex p-6 min-h-0 gap-4">
        <aside className="w-60 shrink-0 h-screen bg-[#0a2540] border border-[#1e3d59] rounded-lg shadow-sm p-4 flex flex-col gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            STOCK VALUE
          </span>

          <button
            type="button"
            onClick={() =>
              setScope((s) => (s === "indian" ? "all" : "indian"))
            }
            className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
              scope === "indian"
                ? "border-[#38ef7d] bg-white/10"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Indian
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(cardStats.indian.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {cardStats.indian.count} item
              {cardStats.indian.count === 1 ? "" : "s"}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setScope((s) => (s === "imported" ? "all" : "imported"))
            }
            className={`w-full text-left bg-white/5 border rounded-lg p-3 transition-all cursor-pointer ${
              scope === "imported"
                ? "border-[#38ef7d] bg-white/10"
                : "border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Imported
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(cardStats.imported.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {cardStats.imported.count} item
              {cardStats.imported.count === 1 ? "" : "s"}
            </span>
          </button>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Major
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(majorStat.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {majorStat.count} item
              {majorStat.count === 1 ? "" : "s"}
            </span>
          </div>

          <div className="w-full text-left bg-white/5 border border-white/10 rounded-lg p-3">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              Minor
            </span>
            <span className="block text-lg font-bold text-white mt-1">
              {fmt(minorStat.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {minorStat.count} item
              {minorStat.count === 1 ? "" : "s"}
            </span>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <GMDUpdateHeader totalRows={totalRows} syncedAt={syncedAt} onSync={handleSync} syncing={syncing} />

          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-4 pr-1 mt-4">
            <GMDUpdateTable
              headers={headers}
              rows={scopedNewItemRows}
              ids={scopedNewItemIds}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title={`New Items (Blank Status)`}
              // hiddenFilters={["NEW ITEM STATUS"]}
              categoryOptions={enhancedCategoryOptions}
              editable
              fixedDropdownOptions={FIXED_DROPDOWN_OPTIONS}
              editableColumns={["CONV", "AUM", "1 pcs wgt", "cost", "Available Stock","INDIAN/IMPORTED","USD cost","HSN CODE","HSN Code Validation", "MAJOR MARKING", "RM TYPE", "NEW ITEM STATUS"]}
              uniqueKeyColumns={["ERP ITEM CODE"]}
              onFilteredRowsChange={setFirstFilteredRows}
              onReset={() => setScope("all")}
              usdInrRate={usdInrRate}
              onRefreshRate={refreshRate}
            />
            <GMDUpdateTable
              headers={headers}
              rows={processedItemRows}
              ids={processedItemIds}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              title="Filtered Items"
              editable
              categoryOptions={enhancedCategoryOptions}
              uniqueKeyColumns={["ERP ITEM CODE"]}
              usdInrRate={usdInrRate}
              onRefreshRate={refreshRate}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
