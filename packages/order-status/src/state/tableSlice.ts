import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";

// Query state of the Order Status table. The host app adds this reducer under `orderStatus`.

export interface OrderStatusState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  /** List fully billed contracts too (they are hidden unless a stage is picked). */
  showDone: boolean;
}

const initialState: OrderStatusState = { page: 1, pageSize: 50, sort: null, search: "", filters: {}, dateRanges: {}, columnSearch: {}, showDone: false };

const slice = createSlice({
  name: "orderStatus",
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
    setShowDone(s, a: PayloadAction<boolean>) {
      s.showDone = a.payload;
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
  },
});

export const { setSearch, setFilter, setDateRange, setColumnSearch, clearFilters, setShowDone, setSort, setPage, setPageSize } = slice.actions;

export const selectOrderStatus = (s: { orderStatus: OrderStatusState }) => s.orderStatus;

export const queryOf = (s: OrderStatusState): TableQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
  extra: { showDone: s.showDone },
});

export default slice.reducer;
