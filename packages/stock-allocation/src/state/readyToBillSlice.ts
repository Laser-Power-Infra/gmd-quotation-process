import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TableQuery, TableSort } from "@gmd/ui/components/data-table/types";

// Query + selection state of the Ready to Bill table. The host app adds this
// reducer under `readyToBill`; the page reads it through selectReadyToBill.

export interface ReadyToBillState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  selectedId: string | null;
}

const initialState: ReadyToBillState = { page: 1, pageSize: 50, sort: null, search: "", filters: {}, selectedId: null };

const slice = createSlice({
  name: "readyToBill",
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
    clearFilters(s) {
      s.filters = {};
      s.search = "";
      s.page = 1;
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
    select(s, a: PayloadAction<string | null>) {
      s.selectedId = a.payload;
    },
  },
});

export const { setSearch, setFilter, clearFilters, setSort, setPage, setPageSize, select } = slice.actions;

export const selectReadyToBill = (s: { readyToBill: ReadyToBillState }) => s.readyToBill;

export const queryOf = (s: ReadyToBillState): TableQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
});

export default slice.reducer;
