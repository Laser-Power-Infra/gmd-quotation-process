import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

const initialState: UiState = {
  expandedRows: {},
  columnWidths: {
    0: 260,
    1: 260,
    2: 240,
    3: 130,
    4: 150,
    5: 120,
    6: 110,
    7: 90,
    8: 110,
    9: 130,
    10: 140,
    11: 220,
    12: 110,
    13: 230,
    14: 220,
    15: 90,
    16: 110,
    17: 130,
    18: 100,
    19: 95,
    20: 110,
    21: 125,
    22: 100,
    23: 110,
    24: 95,
    25: 90,
    26: 120,
    27: 150,
    28: 120,
    29: 140,
    30: 140,
    31: 120,
    32: 80,
  },
  isPartyFilterOpen: false,
  partySearch: "",
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleRow(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.expandedRows[id]) {
        delete state.expandedRows[id];
      } else {
        state.expandedRows[id] = true;
      }
    },
    setExpandedRows(state, action: PayloadAction<Record<string, boolean>>) {
      state.expandedRows = action.payload;
    },
    setColumnWidth(
      state,
      action: PayloadAction<{ index: number; width: number }>
    ) {
      state.columnWidths[action.payload.index] = action.payload.width;
    },
    setPartyFilterOpen(state, action: PayloadAction<boolean>) {
      state.isPartyFilterOpen = action.payload;
    },
    setPartySearch(state, action: PayloadAction<string>) {
      state.partySearch = action.payload;
    },
  },
});

export const {
  toggleRow,
  setExpandedRows,
  setColumnWidth,
  setPartyFilterOpen,
  setPartySearch,
} = uiSlice.actions;

export default uiSlice.reducer;
