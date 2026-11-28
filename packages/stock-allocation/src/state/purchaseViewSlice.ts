import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TableQuery, TableSort } from "@gmd/ui/components/data-table/types";
import type { PurchaseViewKey } from "../purchaseView";

// Query + selection state of the two purchase tables on Stock Allocation (allocations, lots), same shape as
// readyToBillSlice. The host app adds this reducer under `purchaseView`.

export interface PurchaseViewQueryState {
  page: number;
  pageSize: number;
  sort: TableSort | null;
  /** Committed (debounced) search text. */
  search: string;
  filters: Record<string, string[]>;
  selectedId: string | null;
}
export type PurchaseViewState = Record<PurchaseViewKey, PurchaseViewQueryState>;

const blank = (): PurchaseViewQueryState => ({ page: 1, pageSize: 50, sort: null, search: "", filters: {}, selectedId: null });
const initialState: PurchaseViewState = { allocations: blank(), lots: blank() };

type P<T = object> = PayloadAction<{ view: PurchaseViewKey } & T>;

const slice = createSlice({
  name: "purchaseView",
  initialState,
  reducers: {
    setSearch(s, { payload: { view, value } }: P<{ value: string }>) {
      s[view].search = value;
      s[view].page = 1;
    },
    setFilter(s, { payload: { view, key, values } }: P<{ key: string; values: string[] }>) {
      if (values.length) s[view].filters[key] = values;
      else delete s[view].filters[key];
      s[view].page = 1;
    },
    clearFilters(s, { payload: { view } }: P) {
      s[view].filters = {};
      s[view].search = "";
      s[view].page = 1;
    },
    setSort(s, { payload: { view, sort } }: P<{ sort: TableSort | null }>) {
      s[view].sort = sort;
      s[view].page = 1;
    },
    setPage(s, { payload: { view, page } }: P<{ page: number }>) {
      s[view].page = page;
    },
    setPageSize(s, { payload: { view, pageSize } }: P<{ pageSize: number }>) {
      s[view].pageSize = pageSize;
      s[view].page = 1;
    },
    select(s, { payload: { view, id } }: P<{ id: string | null }>) {
      s[view].selectedId = id;
    },
  },
});

export const { setSearch, setFilter, clearFilters, setSort, setPage, setPageSize, select } = slice.actions;

export const selectPurchaseView = (s: { purchaseView: PurchaseViewState }) => s.purchaseView;

export const queryOf = (s: PurchaseViewQueryState): TableQuery => ({
  page: s.page, pageSize: s.pageSize, sort: s.sort, search: s.search, filters: s.filters,
});

export default slice.reducer;
