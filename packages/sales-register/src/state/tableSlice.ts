import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import type { DimKey, View } from "../columns";

// Query state of the Sales Register. The host app adds this reducer under `salesRegister`.

export interface SalesRegisterState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  /** Per dimension, and `month` (yyyy-mm). */
  filters: Record<string, string[]>;
  columnSearch: Record<string, string>;
  /** "" = the current fiscal year. */
  fy: string;
  group: DimKey;
  view: View;
}

const initialState: SalesRegisterState = { page: 1, pageSize: 50, sort: null, search: "", filters: {}, columnSearch: {}, fy: "", group: "party", view: "sales" };

const slice = createSlice({
  name: "salesRegister",
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
    clearFilters(s) {
      Object.assign(s, { filters: {}, columnSearch: {}, search: "", page: 1 });
    },
    /** Another year: its months differ, so a month filter goes. */
    setFy(s, a: PayloadAction<string>) {
      s.fy = a.payload;
      delete s.filters.month;
      s.page = 1;
    },
    /** Another grouping: a sort on the old group column goes; its filter stays (and shows as a chip). */
    setGroup(s, a: PayloadAction<DimKey>) {
      if (s.sort?.key === s.group) s.sort = null;
      s.group = a.payload;
      s.page = 1;
    },
    setView(s, a: PayloadAction<View>) {
      s.view = a.payload;
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

export const { setSearch, setFilter, setColumnSearch, clearFilters, setFy, setGroup, setView, setSort, setPage, setPageSize } = slice.actions;

export const selectSalesRegister = (s: { salesRegister: SalesRegisterState }) => s.salesRegister;

export const queryOf = (s: SalesRegisterState): TableQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  columnSearch: s.columnSearch,
  extra: { fy: s.fy, group: s.group, view: s.view },
});

export default slice.reducer;
