import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 130,  // Enquiry Type
  4: 150,  // State
  5: 120,  // Payment Terms
  6: 150,  // Inspection
  7: 250,  // PBG
  8: 120,  // Utility
  9: 130,  // Order Status
  10: 140, // Closure Status
  11: 160, // Project Reference
  12: 220, // Item Name As Per Party
  13: 110, // Quantity
  14: 230, // Item Type
  15: 220, // MOC
  16: 100, // Size
  17: 120, // PN Rating
  18: 140, // Item Code
  19: 140, // BOM ID
  20: 110, // Operation Type
  21: 100, // Extension
  22: 110, // Bypass
  23: 130, // Other
  24: 110, // Product Cost
  25: 120, // Cost Ref Code
  26: 130, // Cost
  27: 100, // Cost Logic
  28: 120, // Stock Status
  29: 120, // Stock Quantity
  30: 140, // Available Stock
  31: 140, // RM Type
  32: 100, // Stock Against Contract
  33: 120, // Discount
  34: 150, // VA%
  35: 120, // Quoted Rate
  36: 140, // Rate (Contract Review)
  37: 140, // PD Cost Val
  38: 140, // QR incl. GST
  39: 240, // Item Name (Merge)
  40: 140, // Total Value incl. GST
  41: 140, // Itemwise Total Value
  42: 170, // Validation
  43: 180, // Attachment
  44: 140, // Delivery Schedule
  45: 170, // APM
  46: 150, // Offer PDF
  47: 80,  // Actions
};

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
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
