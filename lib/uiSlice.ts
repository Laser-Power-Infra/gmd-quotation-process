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
    10: 220,
    11: 110,
    12: 230,
    13: 220,
    14: 90,
    15: 110,
    16: 130,
    17: 100,
    18: 95,
    19: 110,
    20: 125,
    21: 100,
    22: 110,
    23: 95,
    24: 90,
    25: 120,
    26: 150,
    27: 120,
    28: 140,
    29: 140,
    30: 120,
    31: 80,
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
