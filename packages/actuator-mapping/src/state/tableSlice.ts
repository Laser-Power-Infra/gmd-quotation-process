import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import type { MakeFilter, ViewKey } from "../columns";

// Query state of the Actuator & Gearbox Mapping views, one per tab, so switching tabs keeps each one's
// filters. Actions name their view: a late debounced commit still lands on the table that made it.
// Make is page-wide: it picks the make columns of the mapping and the matrix.
// The host app adds this reducer under `actuatorMapping`.

export interface MappingTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  columnSearch: Record<string, string>;
}

export interface ActuatorMappingState {
  view: ViewKey;
  make: MakeFilter;
  tables: Record<ViewKey, MappingTableState>;
}

const table = (): MappingTableState => ({ page: 1, pageSize: 50, sort: null, search: "", filters: {}, columnSearch: {} });

const initialState: ActuatorMappingState = { view: "mapping", make: "ALL", tables: { mapping: table(), suitability: table(), stock: table() } };

type On<T> = PayloadAction<{ view: ViewKey } & T>;

const slice = createSlice({
  name: "actuatorMapping",
  initialState,
  reducers: {
    setView(s, a: PayloadAction<ViewKey>) {
      s.view = a.payload;
    },
    setMake(s, a: PayloadAction<MakeFilter>) {
      s.make = a.payload;
    },
    setSearch(s, a: On<{ value: string }>) {
      const t = s.tables[a.payload.view];
      t.search = a.payload.value;
      t.page = 1;
    },
    setFilter(s, a: On<{ key: string; values: string[] }>) {
      const t = s.tables[a.payload.view];
      if (a.payload.values.length) t.filters[a.payload.key] = a.payload.values;
      else delete t.filters[a.payload.key];
      t.page = 1;
    },
    setColumnSearch(s, a: On<{ key: string; value: string }>) {
      const t = s.tables[a.payload.view];
      if (a.payload.value.trim()) t.columnSearch[a.payload.key] = a.payload.value.trim();
      else delete t.columnSearch[a.payload.key];
      t.page = 1;
    },
    clearFilters(s, a: PayloadAction<ViewKey>) {
      Object.assign(s.tables[a.payload], { filters: {}, columnSearch: {}, search: "", page: 1 });
    },
    setSort(s, a: On<{ sort: TableSort | null }>) {
      const t = s.tables[a.payload.view];
      t.sort = a.payload.sort;
      t.page = 1;
    },
    setPage(s, a: On<{ page: number }>) {
      s.tables[a.payload.view].page = a.payload.page;
    },
    setPageSize(s, a: On<{ pageSize: number }>) {
      const t = s.tables[a.payload.view];
      t.pageSize = a.payload.pageSize;
      t.page = 1;
    },
  },
});

export const { setView, setMake, setSearch, setFilter, setColumnSearch, clearFilters, setSort, setPage, setPageSize } = slice.actions;

export const selectActuatorMapping = (s: { actuatorMapping: ActuatorMappingState }) => s.actuatorMapping;

export const queryOf = (t: MappingTableState): TableQuery => ({
  page: t.page,
  pageSize: t.pageSize,
  sort: t.sort,
  search: t.search,
  filters: t.filters,
  columnSearch: t.columnSearch,
});

export default slice.reducer;
