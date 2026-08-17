import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FiltersState } from "./types";

const initialState: FiltersState = {
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
  vaPercent: "",
  orderStatus: [],
  closureStatus: "",
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
  productCost: "",
  costRefCode: "",
  cost: "",
  stockStatus: "",
  discount: "",
  quotedRate: "",
  quotedRateGst: "",
  itemNameMerge: "",
  totalValue: "",
  itemWiseTotalValue: "",
  validation: [],
  attachment: "",
};

const filtersSlice = createSlice({
  name: "filters",
  initialState,
  reducers: {
    setFilter(state, action: PayloadAction<{ field: keyof FiltersState; value: any }>) {
      const { field, value } = action.payload;
      (state as any)[field] = value;
    },
    resetFilters() {
      return initialState;
    },
  },
});

export const { setFilter, resetFilters } = filtersSlice.actions;

export default filtersSlice.reducer;
