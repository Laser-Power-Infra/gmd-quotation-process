import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";

// Query + selection state of the Physical Stock table. Each host app adds this
// reducer under `physicalStockTable`; the page reads it through selectStockTable.

export type StockCardKind = "qty" | "value";
export type MajorMinorKind = "yes" | "no" | "blank";

export interface StockTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  card: StockCardKind | null;
  majorMinor: MajorMinorKind[];
  duplicatesOnly: boolean;
  /** Allocation views (quotation host only): narrow the loaded page, not the server query. */
  stockMode: "all" | "free" | "allocated";
  orderText: string;
  selectedId: string | null;
  sidebarCollapsed: boolean;
}

const initialState: StockTableState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: "",
  filters: {},
  dateRanges: {},
  columnSearch: {},
  card: null,
  majorMinor: [],
  duplicatesOnly: false,
  stockMode: "all",
  orderText: "",
  selectedId: null,
  sidebarCollapsed: false,
};

const slice = createSlice({
  name: "physicalStockTable",
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
      s.card = null;
      s.majorMinor = [];
      s.duplicatesOnly = false;
      s.stockMode = "all";
      s.orderText = "";
      s.page = 1;
    },
    setStockMode(s, a: PayloadAction<StockTableState["stockMode"]>) {
      s.stockMode = a.payload;
    },
    setOrderText(s, a: PayloadAction<string>) {
      s.orderText = a.payload;
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
    toggleCard(s, a: PayloadAction<StockCardKind>) {
      s.card = s.card === a.payload ? null : a.payload;
      s.page = 1;
    },
    toggleMajorMinor(s, a: PayloadAction<MajorMinorKind>) {
      s.majorMinor = s.majorMinor.includes(a.payload)
        ? s.majorMinor.filter((k) => k !== a.payload)
        : [...s.majorMinor, a.payload];
      s.page = 1;
    },
    setDuplicatesOnly(s, a: PayloadAction<boolean>) {
      s.duplicatesOnly = a.payload;
      s.page = 1;
    },
    select(s, a: PayloadAction<string | null>) {
      s.selectedId = a.payload;
    },
    toggleSidebar(s) {
      s.sidebarCollapsed = !s.sidebarCollapsed;
    },
  },
});

export const {
  setSearch,
  setFilter,
  setDateRange,
  setColumnSearch,
  clearFilters,
  setSort,
  setPage,
  setPageSize,
  toggleCard,
  toggleMajorMinor,
  setDuplicatesOnly,
  setStockMode,
  setOrderText,
  select,
  toggleSidebar,
} = slice.actions;

export const selectStockTable = (s: { physicalStockTable: StockTableState }) => s.physicalStockTable;

/** Predicates the stock server query understands besides filters/search. */
export interface StockQueryExtra {
  card: StockCardKind | null;
  majorMinor: MajorMinorKind[];
  duplicatesOnly: boolean;
}

export type StockQuery = TableQuery & { extra: StockQueryExtra };

export const queryOf = (s: StockTableState): StockQuery => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
  extra: { card: s.card, majorMinor: s.majorMinor, duplicatesOnly: s.duplicatesOnly },
});

export default slice.reducer;
