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
  productCost: [],
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
  erpItemCode: [],
  erpItemCodeSearch: "",
};

const filtersSlice = createSlice({
  name: "filters",
  initialState,
  reducers: {
    setFilter(state, action: PayloadAction<{ field: keyof FiltersState; value: unknown }>) {
      const { field, value } = action.payload;
      (state as unknown as Record<string, unknown>)[field] = value;
    },
    resetFilters() {
      return initialState;
    },
  },
});

export const { setFilter, resetFilters } = filtersSlice.actions;

export default filtersSlice.reducer;
