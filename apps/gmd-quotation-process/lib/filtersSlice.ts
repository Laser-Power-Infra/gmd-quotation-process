import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FiltersState } from "./types";

export const initialFiltersState: FiltersState = {
  globalSearch: "",
  enquiryDateFrom: "",
  enquiryDateTo: "",
  docketNumber: "",
  docketExact: "",
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
  duplicate: [],
  emailAddress: "",
  contactNo: "",
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
  itemNameMerge: [],
  itemNameMergeSearch: "",
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
  availableStock: [],
  rmType: [],
  deliverySchedule: [],
  stockAgainstContract: "",
  contractNo: [],
  image: [],
  deletedStatus: [],
};

const filtersSlice = createSlice({
  name: "filters",
  initialState: initialFiltersState,
  reducers: {
    setFilter(state, action: PayloadAction<{ field: keyof FiltersState; value: unknown }>) {
      const { field, value } = action.payload;
      (state as unknown as Record<string, unknown>)[field] = value;
      // Typing in the Docket no box goes back to its partial match.
      if (field === "docketNumber") state.docketExact = "";
    },
    /** A DOCKET NO link: exactly that docket, shown in the Docket no box so it can be seen and cleared. */
    setExactDocket(state, action: PayloadAction<string>) {
      state.docketNumber = action.payload;
      state.docketExact = action.payload;
    },
    resetFilters() {
      return initialFiltersState;
    },
  },
});

export const { setFilter, setExactDocket, resetFilters } = filtersSlice.actions;

export default filtersSlice.reducer;
