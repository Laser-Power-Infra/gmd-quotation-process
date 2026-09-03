import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: {
    0: 260,
    1: 260,
    2: 240,
    3: 130,
    4: 150,
    5: 120,
    6: 150,
    7: 250,
    8: 110,
    9: 130,
    10: 140,
    11: 150,
    12: 220,
    13: 110,
    14: 230,
    15: 220,
    16: 90,
    17: 110,
    18: 130,
    19: 130,
    20: 100,
    21: 95,
    22: 110,
    23: 125,
    24: 100,
    25: 110,
    26: 95,
    27: 90,
    28: 120,
    29: 150,
    30: 110,
    31: 120,
    32: 120,
    33: 140,
    34: 140,
    35: 100,
    36: 150,
    37: 120,
    38: 140,
    39: 80,
  },
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleRow(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.expandedRows[id] === true) {
        state.expandedRows[id] = false;
      } else if (state.expandedRows[id] === false) {
        state.expandedRows[id] = true;
      } else {
        state.expandedRows[id] = true;
      }
    },
    setRowExpanded(
      state,
      action: PayloadAction<{ id: string; expanded: boolean }>
    ) {
      state.expandedRows[action.payload.id] = action.payload.expanded;
    },
    setExpandedRows(state, action: PayloadAction<Record<string, boolean>>) {
      state.expandedRows = { ...state.expandedRows, ...action.payload };
    },
    setColumnWidth(
      state,
      action: PayloadAction<{ index: number; width: number }>
    ) {
      state.columnWidths[action.payload.index] = action.payload.width;
    },
    toggleAnalyticsSidebar(state) {
      state.isAnalyticsSidebarCollapsed = !state.isAnalyticsSidebarCollapsed;
    },
    setAnalyticsSidebarCollapsed(state, action: PayloadAction<boolean>) {
      state.isAnalyticsSidebarCollapsed = action.payload;
    },
  },
});

export const {
  toggleRow,
  setRowExpanded,
  setExpandedRows,
  setColumnWidth,
  toggleAnalyticsSidebar,
  setAnalyticsSidebarCollapsed,
} = uiSlice.actions;

export default uiSlice.reducer;
