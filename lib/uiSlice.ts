import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { UiState } from "./types";

export const DEFAULT_COLUMN_WIDTHS: Record<number, number> = {
  0: 220,  // Enquiry Date
  1: 200,  // Docket No
  2: 240,  // Party Name
  3: 160,  // Contract Review
  4: 130,  // Enquiry Type
  5: 150,  // State
  6: 120,  // Payment Terms
  7: 150,  // Inspection
  8: 250,  // PBG
  9: 120,  // Utility
  10: 130, // Order Status
  11: 140, // Closure Status
  12: 160, // Project Reference
  13: 220, // Item Name As Per Party
  14: 110, // Quantity
  15: 230, // Item Type
  16: 220, // MOC
  17: 100, // Size
  18: 120, // PN Rating
  19: 140, // Item Code
  20: 140, // BOM ID
  21: 110, // Operation Type
  22: 100, // Extension
  23: 110, // Bypass
  24: 130, // Other
  25: 110, // Product Cost
  26: 120, // Cost Ref Code
  27: 130, // Cost
  28: 100, // Cost Logic
  29: 120, // Stock Status
  30: 120, // Stock Quantity
  31: 140, // Available Stock
  32: 140, // RM Type
  33: 120, // View Image
  34: 100, // Stock Against Contract
  35: 120, // Discount
  36: 150, // VA%
  37: 120, // Quoted Rate
  38: 140, // Rate (Contract Review)
  39: 140, // PD Cost Val
  40: 140, // QR incl. GST
  41: 240, // Item Name (Merge)
  42: 140, // Total Value incl. GST
  43: 140, // Itemwise Total Value
  44: 170, // Validation
  45: 180, // Attachment
  46: 140, // Delivery Schedule
  47: 170, // APM
  48: 150, // Offer PDF
  49: 80,  // Actions
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
