import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableSort } from "@gmd/ui/components/data-table/types";
import type { PurchaseQuery } from "../poColumns";

// Query + selection state of the Purchases v2 table. The host app adds this
// reducer under `purchaseTable`.

export interface PurchaseTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  /** Only lines with material still to come. */
  openOnly: boolean;
  /** The expanded PO. */
  selectedId: string | null;
}

const initialState: PurchaseTableState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: "",
  filters: {},
  dateRanges: {},
  columnSearch: {},
  openOnly: true,
  selectedId: null,
};

const slice = createSlice({
  name: "purchaseTable",
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
      s.filters = {};
      s.dateRanges = {};
      s.columnSearch = {};
      s.search = "";
      s.page = 1;
    },
    setOpenOnly(s, a: PayloadAction<boolean>) {
      s.openOnly = a.payload;
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

export const { setSearch, setFilter, setDateRange, setColumnSearch, clearFilters, setOpenOnly, setSort, setPage, setPageSize, select } = slice.actions;

export const selectPurchaseTable = (s: { purchaseTable: PurchaseTableState }) => s.purchaseTable;

export const queryOf = (s: PurchaseTableState): PurchaseQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
  extra: { openOnly: s.openOnly },
});

export default slice.reducer;
