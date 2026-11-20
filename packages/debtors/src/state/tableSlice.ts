import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DateRange, TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import type { Bucket } from "../types";

// Query + selection state of the Debtors table. The host app adds this reducer
// under `debtorsTable`; the page reads it through selectDebtorsTable.

export const VIEWS = [
  ["all", "All parties"],
  ["today", "Due today"],
  ["breach", "MSME breach list"],
  ["overdue", "Overdue only"],
  ["over45", "Past 45 days only"],
  ["broken", "Promise broken"],
  ["litigation", "Under litigation"],
] as const;
export type DebtorView = (typeof VIEWS)[number][0];

export interface DebtorsTableState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  search: string;
  filters: Record<string, string[]>;
  dateRanges: Record<string, DateRange>;
  columnSearch: Record<string, string>;
  view: DebtorView;
  bucket: Bucket | null;
  weekOnly: boolean;
  selectedId: string | null;
  amountFormat: "lakh" | "full";
}

const initialState: DebtorsTableState = {
  page: 1,
  pageSize: 50,
  sort: null,
  search: "",
  filters: {},
  dateRanges: {},
  columnSearch: {},
  view: "all",
  bucket: null,
  weekOnly: false,
  selectedId: null,
  amountFormat: "lakh",
};

const slice = createSlice({
  name: "debtorsTable",
  initialState,
  reducers: {
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
      s.view = "all";
      s.bucket = null;
      s.weekOnly = false;
      s.page = 1;
    },
    setView(s, a: PayloadAction<DebtorView>) {
      s.view = a.payload;
      if (a.payload === "breach") s.sort = { key: "totalDues", dir: "desc" }; // biggest amount first
      s.page = 1;
    },
    toggleBucket(s, a: PayloadAction<Bucket>) {
      s.bucket = s.bucket === a.payload ? null : a.payload;
      s.page = 1;
    },
    setWeekOnly(s, a: PayloadAction<boolean>) {
      s.weekOnly = a.payload;
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
    toggleAmountFormat(s) {
      s.amountFormat = s.amountFormat === "lakh" ? "full" : "lakh";
    },
  },
});

export const {
  setFilter,
  setDateRange,
  setColumnSearch,
  clearFilters,
  setView,
  toggleBucket,
  setWeekOnly,
  setSort,
  setPage,
  setPageSize,
  select,
  toggleAmountFormat,
} = slice.actions;

export const selectDebtorsTable = (s: { debtorsTable: DebtorsTableState }) => s.debtorsTable;

/** Predicates the debtors server query understands besides filters/search. */
export interface DebtorQueryExtra {
  view: DebtorView;
  bucket: Bucket | null;
  weekOnly: boolean;
}

export const queryOf = (s: DebtorsTableState): TableQuery & { extra: DebtorQueryExtra } => ({
  page: s.page,
  pageSize: s.pageSize,
  sort: s.sort,
  search: s.search,
  filters: s.filters,
  dateRanges: s.dateRanges,
  columnSearch: s.columnSearch,
  extra: { view: s.view, bucket: s.bucket, weekOnly: s.weekOnly },
});

export default slice.reducer;
