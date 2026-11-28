import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TableSort } from "@gmd/ui/components/data-table/types";
import type { DrawingsQuery } from "../columns";

// Query state of the Drawings page. The host app adds this reducer under `drawingsTable`;
// the page reads it through selectDrawingsTable.

/** "pending": drawings still waiting, i.e. no "No drawings" rows and nothing the client approved. */
export type DrawingsMode = "all" | "pending";

export interface DrawingsTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  columnSearch: Record<string, string>;
  mode: DrawingsMode;
}

const initialState: DrawingsTableState = { page: 1, pageSize: 50, sort: null, search: "", filters: {}, columnSearch: {}, mode: "all" };

const slice = createSlice({
  name: "drawingsTable",
  initialState,
  reducers: {
    setSearch(s, a: PayloadAction<string>) {
      s.search = a.payload;
      s.page = 1;
    },
    setFilter(s, a: PayloadAction<{ key: string; values: string[] }>) {
      if (a.payload.values.length) s.filters[a.payload.key] = a.payload.values;
      else delete s.filters[a.payload.key];
      s.page = 1;
    },
    setColumnSearch(s, a: PayloadAction<{ key: string; value: string }>) {
      if (a.payload.value.trim()) s.columnSearch[a.payload.key] = a.payload.value.trim();
      else delete s.columnSearch[a.payload.key];
      s.page = 1;
    },
    setMode(s, a: PayloadAction<DrawingsMode>) {
      s.mode = a.payload;
      s.page = 1;
    },
    /** The All / Pending view is a tab, not a filter: Clear leaves it as it is. */
    clearFilters(s) {
      Object.assign(s, { filters: {}, columnSearch: {}, search: "", page: 1 });
    },
    setSort(s, a: PayloadAction<TableSort | null>) {
      s.sort = a.payload;
      s.page = 1;
    },
    setPage(s, a: PayloadAction<number>) {
      s.page = a.payload;
    },
    setPageSize(s, a: PayloadAction<number>) {
      s.pageSize = a.payload;
      s.page = 1;
    },
  },
});

export const { setSearch, setFilter, setColumnSearch, setMode, clearFilters, setSort, setPage, setPageSize } = slice.actions;

export const selectDrawingsTable = (s: { drawingsTable: DrawingsTableState }) => s.drawingsTable;

export const queryOf = (s: DrawingsTableState): DrawingsQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  columnSearch: s.columnSearch,
  extra: { pending: s.mode === "pending" },
});

export default slice.reducer;
