import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";

// Query state of the Pending Dockets table. The host app adds this reducer under `pendingDockets`,
// so the filters survive switching tabs on the Docket Follow Up page.

export interface PendingDocketsState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
}

const initialState: PendingDocketsState = { page: 1, pageSize: 25, sort: null, search: "", filters: {}, dateRanges: {}, columnSearch: {} };

const slice = createSlice({
  name: "pendingDockets",
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
    setDateRange(s, a: PayloadAction<{ key: string; range: DateRange | undefined }>) {
      if (a.payload.range) s.dateRanges[a.payload.key] = a.payload.range;
      else delete s.dateRanges[a.payload.key];
      s.page = 1;
    },
    setColumnSearch(s, a: PayloadAction<{ key: string; value: string }>) {
      if (a.payload.value.trim()) s.columnSearch[a.payload.key] = a.payload.value.trim();
      else delete s.columnSearch[a.payload.key];
      s.page = 1;
    },
    clearFilters(s) {
      Object.assign(s, { filters: {}, dateRanges: {}, columnSearch: {}, search: "", page: 1 });
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

export const { setSearch, setFilter, setDateRange, setColumnSearch, clearFilters, setSort, setPage, setPageSize } = slice.actions;

export const selectPendingDockets = (s: { pendingDockets: PendingDocketsState }) => s.pendingDockets;

export const queryOf = (s: PendingDocketsState): TableQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
});

export default slice.reducer;
