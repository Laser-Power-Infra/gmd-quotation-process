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
        (item) => !item.newItemStatus || item.newItemStatus === "-",
      ),
    [allItems],
  );

  const processedItems = useMemo(
    () =>
      allItems.filter(
        (item) => item.newItemStatus && item.newItemStatus !== "-",
      ),
    [allItems],
  );

  const totalRows = allItems.length;

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
            rows={newItems.map(dbItemToRow)}
            ids={newItems.map((i) => i.id)}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title={`New Items (Blank Status)`}
            hiddenFilters={["NEW ITEM STATUS"]}
            categoryOptions={enhancedCategoryOptions}
            editable
            editableColumns={["CONV", "AUM", "1 pcs wgt", "cost", "Available Stock","INDIAN/IMPORTED","USD cost","HSN CODE","HSN Code Validation", "MAJOR MARKING"]}
            uniqueKeyColumns={["ERP ITEM CODE"]}
          />
          <GMDUpdateTable
            headers={headers}
            rows={processedItems.map(dbItemToRow)}
            ids={processedItems.map((i) => i.id)}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            title="Filtered Items"
            editable
            categoryOptions={enhancedCategoryOptions}
            uniqueKeyColumns={["ERP ITEM CODE"]}
          />
        </div>
      </div>
    </main>
  );
}
