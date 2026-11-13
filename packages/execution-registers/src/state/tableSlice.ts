import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import type { RegisterKey } from "../columns";

// Query state of the register tables, one per tab, so switching tabs keeps each one's filters.
// Actions name their register: a late debounced commit still lands on the table that made it.
// The host app adds this reducer under `executionRegisters`.

export interface RegisterTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
}

export interface ExecutionRegistersState {
  tab: RegisterKey;
  tables: Record<RegisterKey, RegisterTableState>;
}

const table = (): RegisterTableState => ({ page: 1, pageSize: 50, sort: null, search: "", filters: {}, dateRanges: {}, columnSearch: {} });

const initialState: ExecutionRegistersState = { tab: "dispatch", tables: { dispatch: table(), mc: table(), production: table() } };

type On<T> = PayloadAction<{ register: RegisterKey } & T>;

const slice = createSlice({
  name: "executionRegisters",
  initialState,
  reducers: {
    setTab(s, a: PayloadAction<RegisterKey>) {
      s.tab = a.payload;
    },
    setSearch(s, a: On<{ value: string }>) {
      const t = s.tables[a.payload.register];
      t.search = a.payload.value;
      t.page = 1;
    },
    setFilter(s, a: On<{ key: string; values: string[] }>) {
      const t = s.tables[a.payload.register];
      if (a.payload.values.length) t.filters[a.payload.key] = a.payload.values;
      else delete t.filters[a.payload.key];
      t.page = 1;
    },
    setDateRange(s, a: On<{ key: string; range: DateRange | undefined }>) {
      const t = s.tables[a.payload.register];
      if (a.payload.range) t.dateRanges[a.payload.key] = a.payload.range;
      else delete t.dateRanges[a.payload.key];
      t.page = 1;
    },
    setColumnSearch(s, a: On<{ key: string; value: string }>) {
      const t = s.tables[a.payload.register];
      if (a.payload.value.trim()) t.columnSearch[a.payload.key] = a.payload.value.trim();
      else delete t.columnSearch[a.payload.key];
      t.page = 1;
    },
    clearFilters(s, a: PayloadAction<RegisterKey>) {
      const t = s.tables[a.payload];
      Object.assign(t, { filters: {}, dateRanges: {}, columnSearch: {}, search: "", page: 1 });
    },
    setSort(s, a: On<{ sort: TableSort | null }>) {
      const t = s.tables[a.payload.register];
      t.sort = a.payload.sort;
      t.page = 1;
    },
    setPage(s, a: On<{ page: number }>) {
      s.tables[a.payload.register].page = a.payload.page;
    },
    setPageSize(s, a: On<{ pageSize: number }>) {
      const t = s.tables[a.payload.register];
      t.pageSize = a.payload.pageSize;
      t.page = 1;
    },
  },
});

export const { setTab, setSearch, setFilter, setDateRange, setColumnSearch, clearFilters, setSort, setPage, setPageSize } = slice.actions;

export const selectExecutionRegisters = (s: { executionRegisters: ExecutionRegistersState }) => s.executionRegisters;

export const queryOf = (t: RegisterTableState): TableQuery => ({
  page: t.page,
  pageSize: t.pageSize,
  sort: t.sort,
  search: t.search,
  filters: t.filters,
  dateRanges: t.dateRanges,
  columnSearch: t.columnSearch,
});

export default slice.reducer;
