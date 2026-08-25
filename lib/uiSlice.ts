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
    19: 100,
    20: 95,
    21: 110,
    22: 125,
    23: 100,
    24: 110,
    25: 95,
    26: 90,
    27: 120,
    28: 150,
    29: 110,
    30: 120,
    31: 120,
    32: 140,
    33: 140,
    34: 100,
    35: 150,
    36: 120,
    37: 140,
    38: 80,
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
