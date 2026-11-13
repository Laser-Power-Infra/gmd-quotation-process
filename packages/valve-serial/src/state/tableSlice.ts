import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";

// Query + selection state of the Valve Serial No table. The host app adds this
// reducer under `valveSerialTable`.

export interface ValveSerialTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  selectedId: string | null;
}

const initialState: ValveSerialTableState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: "",
  filters: {},
  dateRanges: {},
  columnSearch: {},
  selectedId: null,
};

const slice = createSlice({
  name: "valveSerialTable",
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

export const { setSearch, setFilter, setDateRange, setColumnSearch, clearFilters, setSort, setPage, setPageSize, select } = slice.actions;

export const selectValveSerialTable = (s: { valveSerialTable: ValveSerialTableState }) => s.valveSerialTable;

export const queryOf = (s: ValveSerialTableState): TableQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
});

export default slice.reducer;
