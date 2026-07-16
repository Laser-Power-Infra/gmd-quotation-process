import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FiltersState } from "./types";

const initialState: FiltersState = {
  enquiryDateFrom: "",
  enquiryDateTo: "",
  docketNumber: "",
  partyNames: [],
  enquiryType: "All",
  state: "All",
  paymentTerms: "All",
  inspection: "All",
  pbg: "All",
  utility: "",
  vaPercent: "",
  orderStatus: "All",
  closureStatus: "",
  itemName: "",
  quantity: "",
  itemType: "All",
  itemTypeSearch: "",
  moc: "All",
  mocSearch: "",
  size: "All",
  pnRating: "All",
  operationType: "All",
  extension: "All",
  bypass: "All",
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
    setPartyNamesFilter(state, action: PayloadAction<string[]>) {
      state.partyNames = action.payload;
    },
    resetFilters() {
      return initialState;
    },
  },
});

export const { setFilter, setPartyNamesFilter, resetFilters } = filtersSlice.actions;

export default filtersSlice.reducer;
