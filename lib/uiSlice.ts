import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 160,  // Contract Review
  4: 130,  // Enquiry Type
  5: 200,  // State/Utility
  6: 180,  // Payment Terms / PBG / Inspection
  7: 130,  // Order Status
  8: 140,  // Closure Status
  9: 160,  // Project Reference
  10: 300, // Item Name As Per Party
  11: 400, // Details
  12: 110, // Quantity
  13: 140, // Item Code
  14: 140, // BOM ID
  15: 110, // Product Cost
  16: 120, // Cost Ref Code
  17: 130, // Cost
  18: 120, // Stock Status
  19: 120, // Stock Quantity
  20: 140, // Available Stock
  21: 140, // View Image
  22: 100, // Stock Against Contract
  23: 120, // Discount
  24: 150, // VA%
  25: 120, // Quoted Rate
  26: 140, // Rate (Contract Review)
  27: 140, // PD Cost Val
  28: 140, // QR incl. GST
  29: 240, // Item Name (Merge)
  30: 140, // Total Value incl. GST
  31: 140, // Itemwise Total Value
  32: 170, // Validation
  33: 180, // Attachment
  34: 140, // Delivery Schedule
  35: 170, // APM
  36: 150, // Offer PDF
  37: 80,  // Actions
};

const initialState: UiState = {
  expandedRows: {},
  isAnalyticsSidebarCollapsed: false,
  columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
  generatedImages: {},
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
    setGeneratedImages(
      state,
      action: PayloadAction<Record<string, { url: string | null; driveFileId: string | null }>>
    ) {
      state.generatedImages = action.payload;
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
  setGeneratedImages,
} = uiSlice.actions;

export default uiSlice.reducer;
