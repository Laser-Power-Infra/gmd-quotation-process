import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FiltersState } from "./types";

const initialState: FiltersState = {
  globalSearch: "",
  enquiryDateFrom: "",
  enquiryDateTo: "",
  docketNumber: "",
  partyNames: [],
  enquiryType: [],
  state: [],
  paymentTerms: [],
  inspection: [],
  pbg: [],
  utility: [],
  vaPercent: [],
  orderStatus: [],
  closureStatus: [],
  itemName: "",
  quantity: "",
  itemType: [],
  itemTypeSearch: "",
  moc: [],
  mocSearch: "",
  size: [],
  pnRating: [],
  operationType: [],
  extension: [],
  bypass: [],
  others: [],
  othersSearch: "",
  productCost: [],
  costRefCode: [],
  costRefCodeSearch: "",
  cost: [],
  stockStatus: "",
  discount: "",
  quotedRate: "",
  quotedRateGst: "",
  itemNameMerge: "",
  totalValue: "",
  itemWiseTotalValue: "",
  validation: [],
  apm: [],
  attachment: "",
  erpItemCode: [],
  erpItemCodeSearch: "",
  bomId: [],
  bomIdSearch: "",
  contractReviewRate: [],
  contractReviewRateSearch: "",
  pdcostValidation: [],
  pdcostValidationSearch: "",
  stockQuantity: "",
  costLogic: "",
  availableStock: [],
  stockAgainstContract: "",
};

const filtersSlice = createSlice({
  name: "filters",
  initialState,
  reducers: {
    setFilter(state, action: PayloadAction<{ field: keyof FiltersState; value: unknown }>) {
      const { field, value } = action.payload;
      (state as unknown as Record<string, unknown>)[field] = value;
    },
    // "Reset all filters" clears the column filters only. The header search box lived
    // outside this slice before and was never cleared by the reset, so keep it.
    resetFilters(state) {
      return { ...initialState, globalSearch: state.globalSearch };
    },
  },
});

export const { setFilter, resetFilters } = filtersSlice.actions;

export default filtersSlice.reducer;
