import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableSort } from "@gmd/ui/components/data-table/types";
import type { ServiceOrdersQuery } from "../columns";

// Query state of the Service / Work Orders table. The host app adds this reducer under `serviceOrders`.

export interface ServiceOrdersState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  /** Also list fully received lines. */
  showClosed: boolean;
  /** Only lines past their due date. */
  overdueOnly: boolean;
}

const initialState: ServiceOrdersState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: "",
  filters: {},
  dateRanges: {},
  columnSearch: {},
  showClosed: false,
  overdueOnly: false,
};

const slice = createSlice({
  name: "serviceOrders",
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
    setShowClosed(s, a: PayloadAction<boolean>) {
      s.showClosed = a.payload;
      s.page = 1;
    },
    setOverdueOnly(s, a: PayloadAction<boolean>) {
      s.overdueOnly = a.payload;
      s.page = 1;
    },
    /** Every filter off; "Show fully received" is a view choice and stays. */
    clearFilters(s) {
      Object.assign(s, { filters: {}, dateRanges: {}, columnSearch: {}, search: "", overdueOnly: false, page: 1 });
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

export const {
  setSearch,
  setFilter,
  setDateRange,
  setColumnSearch,
  setShowClosed,
  setOverdueOnly,
  clearFilters,
  setSort,
  setPage,
  setPageSize,
} = slice.actions;

export const selectServiceOrders = (s: { serviceOrders: ServiceOrdersState }) => s.serviceOrders;

export const queryOf = (s: ServiceOrdersState): ServiceOrdersQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
  extra: { showClosed: s.showClosed, overdueOnly: s.overdueOnly },
});

export default slice.reducer;
