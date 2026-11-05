"use client";

import { useCallback } from "react";
import { useServerTable as useGenericServerTable, type UseServerTableOptions } from "@gmd/ui/components/data-table/useServerTable";

export interface ServerTablePage {
  rows: unknown[][];
  ids: string[];
  total: number;
  syncedAt?: string | null;
}

export type { UseServerTableOptions };

/** GMDUpdateTable-shaped wrapper over the shared hook (rows/ids arrays, patchCell). */
export function useServerTable<TPage extends ServerTablePage>(options: UseServerTableOptions<TPage>) {
  const table = useGenericServerTable<TPage>(options);
  const { data, setData } = table;

  /** Patch one saved cell without waiting for the background refresh. */
  const patchCell = useCallback(
    (id: string, colIndex: number, value: unknown) => {
      setData((prev) => {
        if (!prev) return prev;
        const rowIndex = prev.ids.indexOf(id);
        if (rowIndex === -1) return prev;
        const rows = prev.rows.map((row, index) =>
          index === rowIndex ? row.map((cell, cellIndex) => (cellIndex === colIndex ? value : cell)) : row,
        );
        return { ...prev, rows };
      });
    },
    [setData],
  );

  return {
    ...table,
    rows: data?.rows ?? [],
    ids: data?.ids ?? [],
    total: data?.total ?? 0,
    syncedAt: data?.syncedAt ?? null,
    patchCell,
  };
}
